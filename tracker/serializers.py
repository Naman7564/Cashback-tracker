from rest_framework import serializers
from django.db import models as db_models
from .models import PaymentSource, Offer, Transaction, UPINumber


class UPINumberSerializer(serializers.ModelSerializer):
    class Meta:
        model = UPINumber
        fields = '__all__'


class PaymentSourceSerializer(serializers.ModelSerializer):
    total_earned = serializers.SerializerMethodField()
    transaction_count = serializers.SerializerMethodField()
    upi_numbers = UPINumberSerializer(many=True, read_only=True)

    class Meta:
        model = PaymentSource
        fields = '__all__'

    def get_total_earned(self, obj):
        total = obj.transactions.filter(status='received').aggregate(
            total=db_models.Sum('actual_cashback'))['total']
        return float(total or 0)

    def get_transaction_count(self, obj):
        return obj.transactions.count()


class OfferSerializer(serializers.ModelSerializer):
    source_name = serializers.ReadOnlyField(source='source.name')

    class Meta:
        model = Offer
        fields = '__all__'


class TransactionSerializer(serializers.ModelSerializer):
    source_name_display = serializers.SerializerMethodField()
    source_color = serializers.SerializerMethodField()
    source_type = serializers.SerializerMethodField()
    upi_number_ids = serializers.PrimaryKeyRelatedField(
        source='upi_numbers', queryset=UPINumber.objects.all(),
        many=True, required=False
    )
    upi_numbers_detail = UPINumberSerializer(source='upi_numbers', many=True, read_only=True)

    class Meta:
        model = Transaction
        fields = '__all__'

    def get_source_name_display(self, obj):
        return obj.source_name or (obj.source.name if obj.source else '')

    def get_source_color(self, obj):
        return obj.source.color if obj.source else '#64748b'

    def get_source_type(self, obj):
        return obj.transaction_type or (obj.source.source_type if obj.source else 'credit')
