from django.contrib import admin
from .models import PaymentSource, Offer, Transaction


@admin.register(PaymentSource)
class PaymentSourceAdmin(admin.ModelAdmin):
    list_display = ('name', 'source_type', 'provider', 'network', 'is_active')
    list_filter = ('source_type', 'is_active', 'provider')
    search_fields = ('name', 'provider')


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    list_display = ('source', 'category', 'offer_type', 'value', 'max_cap', 'valid_until', 'is_active')
    list_filter = ('offer_type', 'is_active', 'category')
    search_fields = ('category',)


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ('source_name', 'amount', 'source', 'transaction_type', 'expected_cashback', 'actual_cashback', 'status', 'transaction_date')
    list_filter = ('status', 'statement_month', 'transaction_type')
    search_fields = ('source_name',)
