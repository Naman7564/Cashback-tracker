from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'sources', views.PaymentSourceViewSet)
router.register(r'offers', views.OfferViewSet)
router.register(r'transactions', views.TransactionViewSet)
router.register(r'upi-numbers', views.UPINumberViewSet)

urlpatterns = [
    path('', include(router.urls)),
    path('calculate-cashback/', views.calculate_cashback),
    path('dashboard-stats/', views.dashboard_stats),
    path('todo/', views.todo_list),
    path('todo/record/', views.todo_record),
    path('todo/set-target/', views.set_daily_target),
]
