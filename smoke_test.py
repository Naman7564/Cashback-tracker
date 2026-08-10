"""Smoke test: create source, offer, transaction, calculate cashback."""
import os, sys, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'cashback_project.settings')
sys.path.insert(0, os.path.dirname(__file__))
django.setup()

from datetime import date, timedelta
from decimal import Decimal
from tracker.models import PaymentSource, Offer, Transaction

# Clean
Transaction.objects.all().delete()
Offer.objects.all().delete()
PaymentSource.objects.all().delete()

# Create source
src = PaymentSource.objects.create(name='HDFC Millennia', source_type='credit', provider='HDFC', network='Visa', color='#3b82f6')
assert src.id, "Source creation failed"

# Create offer
ofr = Offer.objects.create(
    source=src, category='Groceries', offer_type='percentage', value=Decimal('5.00'),
    max_cap=Decimal('200.00'), valid_from=date.today() - timedelta(days=1),
    valid_until=date.today() + timedelta(days=30)
)
assert ofr.id, "Offer creation failed"

# Create transaction
txn = Transaction.objects.create(
    source=src, offer=ofr, amount=Decimal('1000.00'), merchant='BigBasket',
    category='Groceries', expected_cashback=Decimal('50.00'),
    transaction_date=date.today(), status='pending'
)
assert txn.statement_month == f"{date.today().year}-{date.today().month:02d}", f"Statement month wrong: {txn.statement_month}"

# Test cashback calc logic
from rest_framework.test import APIRequestFactory
from tracker.views import calculate_cashback
factory = APIRequestFactory()
req = factory.post('/api/calculate-cashback/', {'source_id': src.id, 'amount': 5000, 'category': 'groceries'}, format='json')
resp = calculate_cashback(req)
assert resp.data['expected_cashback'] == 200.0, f"Cashback calc wrong: {resp.data}"  # 5% of 5000 = 250, capped at 200
assert resp.data['offer_id'] == ofr.id

# Test with amount below cap
req2 = factory.post('/api/calculate-cashback/', {'source_id': src.id, 'amount': 1000, 'category': 'Groceries'}, format='json')
resp2 = calculate_cashback(req2)
assert resp2.data['expected_cashback'] == 50.0, f"Cashback calc wrong: {resp2.data}"  # 5% of 1000 = 50

# Test no matching offer
req3 = factory.post('/api/calculate-cashback/', {'source_id': src.id, 'amount': 1000, 'category': 'Fuel'}, format='json')
resp3 = calculate_cashback(req3)
assert resp3.data['expected_cashback'] == 0, f"Should be 0 for non-matching category: {resp3.data}"

print("All smoke tests passed!")
