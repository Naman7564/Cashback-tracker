from rest_framework import serializers
from django.db import models as db_models
from .models import PaymentSource, Offer, Transaction


class PaymentSourceSerializer(serializers.ModelSerializer):
    total_earned = serializers.SerializerMethodField()

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

    class Meta:
        model = Transaction
        fields = '__all__'
