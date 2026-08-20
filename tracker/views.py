import csv
import json
import os
import shutil
from datetime import date, timedelta
from decimal import Decimal
from django.utils import timezone
from django.conf import settings
from django.http import HttpResponse, FileResponse
from django.db import transaction as db_transaction
from django.db.models import Sum, Value, DecimalField
from django.db.models.functions import Coalesce
from rest_framework import viewsets, status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models import PaymentSource, Offer, Transaction, UPINumber
from .serializers import (
    PaymentSourceSerializer, OfferSerializer, TransactionSerializer,
    UPINumberSerializer
)


@api_view(['GET'])
def export_csv(request):
    response = HttpResponse(content_type='text/csv')
    response['Content-Disposition'] = 'attachment; filename="cashback_transactions.csv"'

    writer = csv.writer(response)
    writer.writerow(['Date', 'Source', 'Type', 'Amount', 'Cashback', 'Status', 'Notes'])

    txns = Transaction.objects.select_related('source').all().order_by('-transaction_date')
    for t in txns:
        source_name = t.source_name or (t.source.name if t.source else '')
        source_type = t.transaction_type or (t.source.source_type if t.source else '')
        cashback = t.actual_cashback if t.status == 'received' and t.actual_cashback is not None else t.expected_cashback
        writer.writerow([
            t.transaction_date,
            source_name,
            source_type,
            t.amount,
            cashback,
            t.status,
            t.notes or ''
        ])

    return response


@api_view(['GET'])
def export_json(request):
    data = {
        'sources': PaymentSourceSerializer(PaymentSource.objects.all(), many=True).data,
        'offers': OfferSerializer(Offer.objects.all(), many=True).data,
        'transactions': TransactionSerializer(Transaction.objects.all(), many=True).data,
        'upi_numbers': UPINumberSerializer(UPINumber.objects.all(), many=True).data,
    }
    response = HttpResponse(json.dumps(data, indent=2), content_type='application/json')
    response['Content-Disposition'] = 'attachment; filename="cashback_backup.json"'
    return response


@api_view(['GET'])
def backup_download(request):
    db_path = settings.DATABASES['default']['NAME']
    if not os.path.exists(db_path):
        return Response({'error': 'Database file not found'}, status=status.HTTP_404_NOT_FOUND)

    response = FileResponse(open(db_path, 'rb'), content_type='application/x-sqlite3')
    response['Content-Disposition'] = 'attachment; filename="db.sqlite3"'
    return response


@api_view(['POST'])
def backup_restore(request):
    uploaded_file = request.FILES.get('file')
    if not uploaded_file:
        return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)

    filename = uploaded_file.name.lower()
    if filename.endswith('.json'):
        try:
            content = json.loads(uploaded_file.read().decode('utf-8'))
        except Exception:
            return Response({'error': 'Invalid JSON file'}, status=status.HTTP_400_BAD_REQUEST)

        with db_transaction.atomic():
            Transaction.objects.all().delete()
            Offer.objects.all().delete()
            UPINumber.objects.all().delete()
            PaymentSource.objects.all().delete()

            for s in content.get('sources', []):
                PaymentSource.objects.create(
                    id=s['id'], name=s['name'], source_type=s['source_type'],
                    provider=s['provider'], network=s.get('network', ''),
                    color=s.get('color', '#3b82f6'), daily_target=s.get('daily_target', 0),
                    is_active=s.get('is_active', True)
                )
            for u in content.get('upi_numbers', []):
                UPINumber.objects.create(
                    id=u['id'], source_id=u['source'], upi_id=u['upi_id'],
                    label=u.get('label', ''), is_active=u.get('is_active', True)
                )
            for o in content.get('offers', []):
                Offer.objects.create(
                    id=o['id'], source_id=o['source'], category=o['category'],
                    offer_type=o['offer_type'], value=o['value'],
                    max_cap=o.get('max_cap'), valid_from=o['valid_from'],
                    valid_until=o['valid_until'], terms=o.get('terms', ''),
                    is_active=o.get('is_active', True)
                )
            for t in content.get('transactions', []):
                txn = Transaction.objects.create(
                    id=t['id'], source_id=t.get('source'),
                    source_name=t.get('source_name', ''),
                    transaction_type=t.get('transaction_type', 'credit'),
                    offer_id=t.get('offer'), amount=t['amount'],
                    expected_cashback=t.get('expected_cashback', 0),
                    actual_cashback=t.get('actual_cashback'),
                    status=t.get('status', 'pending'),
                    transaction_date=t['transaction_date'],
                    notes=t.get('notes', '')
                )
                if t.get('upi_number_ids'):
                    txn.upi_numbers.set(t['upi_number_ids'])

        return Response({'message': 'JSON restored successfully'})

    elif filename.endswith('.sqlite3') or filename.endswith('.db') or filename.endswith('.sqlite'):
        db_path = settings.DATABASES['default']['NAME']
        try:
            with open(db_path, 'wb') as destination:
                for chunk in uploaded_file.chunks():
                    destination.write(chunk)
            return Response({'message': 'SQLite database restored successfully'})
        except Exception as e:
            return Response({'error': f'Failed to restore database: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response({'error': 'Unsupported file format. Please upload .sqlite3 or .json'}, status=status.HTTP_400_BAD_REQUEST)


class PaymentSourceViewSet(viewsets.ModelViewSet):
    queryset = PaymentSource.objects.all()
    serializer_class = PaymentSourceSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        return qs


class OfferViewSet(viewsets.ModelViewSet):
    queryset = Offer.objects.select_related('source').all()
    serializer_class = OfferSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        source = self.request.query_params.get('source')
        category = self.request.query_params.get('category')
        is_active = self.request.query_params.get('is_active')
        if source:
            qs = qs.filter(source_id=source)
        if category:
            qs = qs.filter(category__iexact=category)
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        return qs


class TransactionViewSet(viewsets.ModelViewSet):
    queryset = Transaction.objects.select_related('source', 'offer').prefetch_related('upi_numbers').all()
    serializer_class = TransactionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        source = self.request.query_params.get('source')
        status_filter = self.request.query_params.get('status')
        month = self.request.query_params.get('statement_month')
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        ordering = self.request.query_params.get('ordering', '-transaction_date')
        limit = self.request.query_params.get('limit')
        if source:
            qs = qs.filter(source_id=source)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if month:
            qs = qs.filter(statement_month=month)
        if date_from:
            qs = qs.filter(transaction_date__gte=date_from)
        if date_to:
            qs = qs.filter(transaction_date__lte=date_to)
        if ordering:
            qs = qs.order_by(ordering)
        if limit:
            qs = qs[:int(limit)]
        return qs


@api_view(['POST'])
def calculate_cashback(request):
    source_id = request.data.get('source_id')
    amount = request.data.get('amount', 0)
    category = request.data.get('category', '')

    if not source_id or not amount:
        return Response({'error': 'source_id and amount required'}, status=status.HTTP_400_BAD_REQUEST)

    amount = Decimal(str(amount))
    today = timezone.localdate()
    offers = Offer.objects.filter(
        source_id=source_id, is_active=True,
        valid_from__lte=today, valid_until__gte=today,
    )
    if category:
        offers = offers.filter(category__iexact=category)

    offer = offers.first()
    if not offer:
        return Response({'expected_cashback': 0, 'offer_id': None, 'offer_details': None})

    if offer.offer_type == 'percentage':
        cashback = amount * (offer.value / 100)
        if offer.max_cap:
            cashback = min(cashback, offer.max_cap)
    else:
        cashback = offer.value

    return Response({
        'expected_cashback': float(cashback.quantize(Decimal('0.01'))),
        'offer_id': offer.id,
        'offer_details': {
            'category': offer.category,
            'offer_type': offer.offer_type,
            'value': float(offer.value),
            'max_cap': float(offer.max_cap) if offer.max_cap else None,
        }
    })


@api_view(['GET'])
def analytics_data(request):
    period = request.query_params.get('period', 'month')

    today = timezone.localdate()

    qs = Transaction.objects.all()

    if period == 'month':
        qs = qs.filter(transaction_date__year=today.year, transaction_date__month=today.month)
    elif period == 'last_month':
        first_of_this_month = date(today.year, today.month, 1)
        last_month = first_of_this_month - timedelta(days=1)
        qs = qs.filter(transaction_date__year=last_month.year, transaction_date__month=last_month.month)
    elif period == 'quarter':
        start_date = today - timedelta(days=90)
        qs = qs.filter(transaction_date__gte=start_date)
    elif period == 'year':
        qs = qs.filter(transaction_date__year=today.year)
    # 'all' uses all records

    cashback_expr = Coalesce('actual_cashback', 'expected_cashback', Value(0), output_field=DecimalField())

    total_earned = qs.aggregate(total=Sum(cashback_expr))['total'] or Decimal('0.00')

    # Best source calculation
    best_source_data = None
    sources_totals = {}
    for t in qs:
        name = t.source.name if t.source else 'Other'
        color = t.source.color if t.source else '#6366f1'
        cb = t.actual_cashback if (t.status == 'received' and t.actual_cashback is not None) else t.expected_cashback
        cb = float(cb or 0)
        if name not in sources_totals:
            sources_totals[name] = {'amount': 0.0, 'color': color}
        sources_totals[name]['amount'] += cb

    if sources_totals:
        best_name = max(sources_totals, key=lambda k: sources_totals[k]['amount'])
        if sources_totals[best_name]['amount'] > 0:
            best_source_data = {
                'name': best_name,
                'amount': float(Decimal(str(sources_totals[best_name]['amount'])).quantize(Decimal('0.01'))),
                'color': sources_totals[best_name]['color']
            }

    # Daily trend (for month/last_month/quarter or default)
    daily_trend = []
    if period in ['month', 'last_month']:
        days_in_month = 31
        if period == 'month':
            m = today.month
            y = today.year
        else:
            first = date(today.year, today.month, 1)
            lm = first - timedelta(days=1)
            m = lm.month
            y = lm.year

        import calendar
        days_in_month = calendar.monthrange(y, m)[1]

        daily_map = {d: 0.0 for d in range(1, days_in_month + 1)}
        for t in qs:
            d = t.transaction_date.day
            cb = t.actual_cashback if (t.status == 'received' and t.actual_cashback is not None) else t.expected_cashback
            daily_map[d] += float(cb or 0)

        daily_trend = [{'day': d, 'earned': float(Decimal(str(v)).quantize(Decimal('0.01')))} for d, v in daily_map.items()]
    else:
        # Fallback daily/sample trend
        daily_trend = [{'day': i, 'earned': 0.0} for i in range(1, 31)]

    # Source breakdown & top sources
    tot_earned_float = float(total_earned)
    source_breakdown = []
    top_sources = []
    sorted_sources = sorted(sources_totals.items(), key=lambda x: x[1]['amount'], reverse=True)

    rank = 1
    for name, sdata in sorted_sources:
        amt = sdata['amount']
        pct = round((amt / tot_earned_float * 100), 1) if tot_earned_float > 0 else 0
        amt_fmt = float(Decimal(str(amt)).quantize(Decimal('0.01')))
        source_breakdown.append({
            'source': name,
            'amount': amt_fmt,
            'color': sdata['color'],
            'percentage': pct
        })
        if rank <= 5:
            top_sources.append({
                'rank': rank,
                'name': name,
                'amount': amt_fmt,
                'color': sdata['color']
            })
            rank += 1

    # Monthly comparison (last 6 months)
    monthly_comparison = []
    for i in range(5, -1, -1):
        m_date = today - timedelta(days=i*30)
        m_qs = Transaction.objects.filter(transaction_date__year=m_date.year, transaction_date__month=m_date.month)
        m_earned = m_qs.aggregate(total=Sum(cashback_expr))['total'] or Decimal('0.00')
        monthly_comparison.append({
            'month': m_date.strftime('%b'),
            'earned': float(m_earned)
        })

    period_str = f"{today.year}-{today.month:02d}"
    if period == 'last_month':
        first = date(today.year, today.month, 1)
        lm = first - timedelta(days=1)
        period_str = f"{lm.year}-{lm.month:02d}"

    res_data = {
        'period': period_str,
        'total_earned': float(total_earned),
        'best_source': best_source_data,
        'daily_trend': daily_trend,
        'source_breakdown': source_breakdown,
        'top_sources': top_sources,
        'monthly_comparison': monthly_comparison
    }
    return Response(res_data)


@api_view(['GET'])
def dashboard_stats(request):
    today = timezone.localdate()
    month = f"{today.year}-{today.month:02d}"

    total_cashback = Transaction.objects.aggregate(
        total=Sum(Coalesce('actual_cashback', 'expected_cashback', Value(0), output_field=DecimalField()))
    )['total'] or 0

    pending = Transaction.objects.filter(status='pending').aggregate(
        total=Sum('expected_cashback'))['total'] or 0

    earned_this_month = Transaction.objects.filter(
        status='received', statement_month=month
    ).aggregate(total=Sum('actual_cashback'))['total'] or 0

    active_sources = PaymentSource.objects.filter(is_active=True).count()

    best = Transaction.objects.filter(
        status='received', statement_month=month
    ).values('source__name').annotate(
        total=Sum('actual_cashback')
    ).order_by('-total').first()

    recent = Transaction.objects.select_related('source').prefetch_related('upi_numbers')[:5]

    res_data = {
        'total_cashback': float(total_cashback),
        'pending_cashback': float(pending),
        'earned_this_month': float(earned_this_month),
        'active_sources': active_sources,
        'best_source': best['source__name'] if best else None,
        'recent_transactions': TransactionSerializer(recent, many=True).data,
    }
    return Response(res_data)


class UPINumberViewSet(viewsets.ModelViewSet):
    queryset = UPINumber.objects.all()
    serializer_class = UPINumberSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        source = self.request.query_params.get('source_id')
        if source:
            qs = qs.filter(source_id=source)
        return qs


@api_view(['GET'])
def todo_list(request):
    """Get all sources with daily target and earned-so-far for a given date."""
    target_param = request.query_params.get('date')
    if not target_param or target_param.lower() == 'today':
        target_date = str(timezone.localdate())
    elif target_param.lower() == 'yesterday':
        target_date = str(timezone.localdate() - timedelta(days=1))
    else:
        target_date = target_param

    sources = PaymentSource.objects.filter(is_active=True).prefetch_related('upi_numbers')
    result = []
    for s in sources:
        # ponytail: per-row fallback — actual_cashback if set, else expected_cashback
        earned = Transaction.objects.filter(
            source=s, transaction_date=target_date
        ).aggregate(total=Sum(Coalesce(
            'actual_cashback', 'expected_cashback', Value(0),
            output_field=DecimalField()
        )))['total'] or 0
        txns_today = Transaction.objects.filter(
            source=s, transaction_date=target_date
        ).order_by('-created_at')[:5]
        result.append({
            'source': PaymentSourceSerializer(s).data,
            'daily_target': float(s.daily_target),
            'earned_so_far': float(earned),
            'transactions_today': TransactionSerializer(txns_today, many=True).data,
            'upi_numbers': UPINumberSerializer(s.upi_numbers.filter(is_active=True), many=True).data
                if s.source_type == 'upi' else [],
        })
    # Overall summary
    total_target = sum(r['daily_target'] for r in result)
    total_earned = sum(r['earned_so_far'] for r in result)
    res_data = {
        'date': target_date,
        'total_target': total_target,
        'total_earned': total_earned,
        'sources': result,
    }
    return Response(res_data)


@api_view(['POST'])
def todo_record(request):
    """Record a transaction from the To Do page."""
    source_id = request.data.get('source_id')
    amount = request.data.get('amount', 0)
    merchant = request.data.get('merchant', '')
    cashback_amount = request.data.get('cashback_amount', 0)
    upi_number_ids = request.data.get('upi_number_ids', [])
    txn_date = request.data.get('date', str(timezone.localdate()))
    category = request.data.get('category', '')

    if not source_id or not amount:
        return Response({'error': 'source_id and amount required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        source = PaymentSource.objects.get(id=source_id)
    except PaymentSource.DoesNotExist:
        return Response({'error': 'Source not found'}, status=status.HTTP_404_NOT_FOUND)

    try:
        parsed_date = date.fromisoformat(txn_date)
    except (ValueError, TypeError):
        return Response({'error': 'Invalid date format'}, status=status.HTTP_400_BAD_REQUEST)

    txn = Transaction.objects.create(
        source=source,
        source_name=merchant or source.name,
        transaction_type=source.source_type,
        category=category,
        amount=Decimal(str(amount)),
        expected_cashback=Decimal(str(cashback_amount)),
        actual_cashback=Decimal(str(cashback_amount)),
        status='received',
        transaction_date=parsed_date,
    )
    if upi_number_ids and source.source_type == 'upi':
        txn.upi_numbers.set(upi_number_ids)

    return Response(TransactionSerializer(txn).data, status=status.HTTP_201_CREATED)
