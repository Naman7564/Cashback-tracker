from django.db import models


class PaymentSource(models.Model):
    SOURCE_TYPES = [('debit', 'Debit'), ('credit', 'Credit'), ('upi', 'UPI')]

    name = models.CharField(max_length=100)
    source_type = models.CharField(max_length=10, choices=SOURCE_TYPES)
    provider = models.CharField(max_length=100)
    network = models.CharField(max_length=50, blank=True)
    color = models.CharField(max_length=7, default='#3b82f6')
    daily_target = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.provider})"


class Offer(models.Model):
    OFFER_TYPES = [('percentage', 'Percentage'), ('flat', 'Flat')]

    source = models.ForeignKey(PaymentSource, on_delete=models.CASCADE, related_name='offers')
    category = models.CharField(max_length=100)
    offer_type = models.CharField(max_length=10, choices=OFFER_TYPES)
    value = models.DecimalField(max_digits=10, decimal_places=2)
    max_cap = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    valid_from = models.DateField()
    valid_until = models.DateField()
    terms = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['valid_until']

    def __str__(self):
        return f"{self.source.name} - {self.category} ({self.offer_type}: {self.value})"


class Transaction(models.Model):
    STATUS_CHOICES = [('pending', 'Pending'), ('received', 'Received'), ('disputed', 'Disputed'), ('na', 'N/A')]

    source = models.ForeignKey(PaymentSource, on_delete=models.CASCADE, related_name='transactions')
    offer = models.ForeignKey(Offer, on_delete=models.SET_NULL, null=True, blank=True, related_name='transactions')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    merchant = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True)
    expected_cashback = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    actual_cashback = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending')
    transaction_date = models.DateField()
    statement_month = models.CharField(max_length=7, blank=True)
    upi_numbers = models.ManyToManyField('UPINumber', blank=True, related_name='transactions')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-transaction_date']

    def save(self, *args, **kwargs):
        if self.transaction_date:
            self.statement_month = f"{self.transaction_date.year}-{self.transaction_date.month:02d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.merchant} - ₹{self.amount} ({self.status})"


class UPINumber(models.Model):
    source = models.ForeignKey(PaymentSource, on_delete=models.CASCADE, related_name='upi_numbers')
    upi_id = models.CharField(max_length=100)
    label = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['upi_id']

    def __str__(self):
        return f"{self.upi_id} ({self.label or 'No label'})"
