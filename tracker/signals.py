from django.core.cache import cache
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import PaymentSource, Transaction, Offer, UPINumber

def clear_cache_pattern(pattern):
    try:
        if hasattr(cache, 'delete_pattern'):
            cache.delete_pattern(pattern)
        else:
            cache.clear()
    except Exception:
        pass

@receiver([post_save, post_delete], sender=Transaction)
def invalidate_transaction_cache(sender, instance, **kwargs):
    try:
        cache.delete(f"todo:{instance.transaction_date}")
        cache.delete("dashboard:summary")
        clear_cache_pattern("cashback:analytics:*")
    except Exception:
        pass

@receiver([post_save, post_delete], sender=PaymentSource)
@receiver([post_save, post_delete], sender=Offer)
@receiver([post_save, post_delete], sender=UPINumber)
def invalidate_source_cache(sender, instance, **kwargs):
    try:
        cache.delete("sources:list")
        cache.delete("dashboard:summary")
        clear_cache_pattern("cashback:analytics:*")
    except Exception:
        pass
