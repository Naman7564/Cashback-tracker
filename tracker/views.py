from datetime import date
from decimal import Decimal
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
    queryset = Transaction.objects.select_related('source', 'offer').all()
    serializer_class = TransactionSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        source = self.request.query_params.get('source')
        status_filter = self.request.query_params.get('status')
        month = self.request.query_params.get('statement_month')
        if source:
            qs = qs.filter(source_id=source)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if month:
            qs = qs.filter(statement_month=month)
        return qs


@api_view(['POST'])
def calculate_cashback(request):
    source_id = request.data.get('source_id')
    amount = request.data.get('amount', 0)
    category = request.data.get('category', '')

    if not source_id or not amount:
        return Response({'error': 'source_id and amount required'}, status=status.HTTP_400_BAD_REQUEST)

    amount = Decimal(str(amount))
    today = date.today()
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
def dashboard_stats(request):
    today = date.today()
    month = f"{today.year}-{today.month:02d}"

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

    recent = Transaction.objects.select_related('source')[:5]

    return Response({
        'pending_cashback': float(pending),
        'earned_this_month': float(earned_this_month),
        'active_sources': active_sources,
        'best_source': best['source__name'] if best else None,
        'recent_transactions': TransactionSerializer(recent, many=True).data,
    })


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
    target_date = request.query_params.get('date', str(date.today()))
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
    return Response({
        'date': target_date,
        'total_target': total_target,
        'total_earned': total_earned,
        'sources': result,
    })


@api_view(['POST'])
def todo_record(request):
    """Record a transaction from the To Do page."""
    source_id = request.data.get('source_id')
    amount = request.data.get('amount', 0)
    merchant = request.data.get('merchant', '')
    cashback_amount = request.data.get('cashback_amount', 0)
    upi_number_ids = request.data.get('upi_number_ids', [])
    txn_date = request.data.get('date', str(date.today()))
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
        amount=Decimal(str(amount)),
        merchant=merchant or source.name,
        category=category,
        expected_cashback=Decimal(str(cashback_amount)),
        actual_cashback=Decimal(str(cashback_amount)),
        status='received',
        transaction_date=parsed_date,
    )
    if upi_number_ids and source.source_type == 'upi':
        txn.upi_numbers.set(upi_number_ids)

    return Response(TransactionSerializer(txn).data, status=status.HTTP_201_CREATED)
