from rest_framework import serializers
from django.db import models as db_models
from .models import PaymentSource, Offer, Transaction, UPINumber


class UPINumberSerializer(serializers.ModelSerializer):
    class Meta:
        model = UPINumber
        fields = '__all__'


class PaymentSourceSerializer(serializers.ModelSerializer):
    total_earned = serializers.SerializerMethodField()
    upi_numbers = UPINumberSerializer(many=True, read_only=True)

    class Meta:
        model = PaymentSource
        fields = '__all__'

    def get_total_earned(self, obj):
        total = obj.transactions.filter(status='received').aggregate(
            total=db_models.Sum('actual_cashback'))['total']
        return float(total or 0)


class OfferSerializer(serializers.ModelSerializer):
    source_name = serializers.ReadOnlyField(source='source.name')

    class Meta:
        model = Offer
        fields = '__all__'


class TransactionSerializer(serializers.ModelSerializer):
    source_name = serializers.ReadOnlyField(source='source.name')
    source_color = serializers.ReadOnlyField(source='source.color')
    source_type = serializers.ReadOnlyField(source='source.source_type')
    upi_number_ids = serializers.PrimaryKeyRelatedField(
        source='upi_numbers', queryset=UPINumber.objects.all(),
        many=True, required=False
    )
    upi_numbers_detail = UPINumberSerializer(source='upi_numbers', many=True, read_only=True)

    class Meta:
        model = Transaction
        fields = '__all__'
