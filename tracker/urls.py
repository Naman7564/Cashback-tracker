from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'sources', views.PaymentSourceViewSet)
router.register(r'offers', views.OfferViewSet)
router.register(r'transactions', views.TransactionViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('calculate-cashback/', views.calculate_cashback),
    path('dashboard-stats/', views.dashboard_stats),
]
