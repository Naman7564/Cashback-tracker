from datetime import timedelta
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from tracker.models import PaymentSource, Transaction

class TodoAPITimezoneTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.source = PaymentSource.objects.create(
            name="Test Card",
            source_type="credit",
            provider="HDFC",
            daily_target=100.0,
            is_active=True
        )

    def test_todo_default_and_explicit_ist_dates(self):
        today = timezone.localdate()
        yesterday = today - timedelta(days=1)

        # Create yesterday transaction
        Transaction.objects.create(
            source=self.source,
            source_name="Merchant Yesterday",
            transaction_type="credit",
            amount=500.0,
            actual_cashback=50.0,
            status="received",
            transaction_date=yesterday
        )

        # Create today transaction
        Transaction.objects.create(
            source=self.source,
            source_name="Merchant Today",
            transaction_type="credit",
            amount=300.0,
            actual_cashback=30.0,
            status="received",
            transaction_date=today
        )

        # 1. Default request (today)
        res_default = self.client.get('/api/todo/')
        self.assertEqual(res_default.status_code, 200)
        self.assertEqual(res_default.data['date'], str(today))
        self.assertEqual(res_default.data['total_earned'], 30.0)

        # 2. Explicit ?date=today
        res_today = self.client.get('/api/todo/?date=today')
        self.assertEqual(res_today.status_code, 200)
        self.assertEqual(res_today.data['date'], str(today))
        self.assertEqual(res_today.data['total_earned'], 30.0)

        # 3. Explicit ?date=yesterday
        res_yesterday = self.client.get('/api/todo/?date=yesterday')
        self.assertEqual(res_yesterday.status_code, 200)
        self.assertEqual(res_yesterday.data['date'], str(yesterday))
        self.assertEqual(res_yesterday.data['total_earned'], 50.0)

        # 4. Explicit ISO date
        res_iso = self.client.get(f'/api/todo/?date={yesterday}')
        self.assertEqual(res_iso.status_code, 200)
        self.assertEqual(res_iso.data['total_earned'], 50.0)
