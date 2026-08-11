from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('tracker.urls')),
    path('todo/', TemplateView.as_view(template_name='index.html'), name='todo'),
    path('cards/', TemplateView.as_view(template_name='index.html'), name='cards'),
    path('analytics/', TemplateView.as_view(template_name='index.html'), name='analytics'),
    path('transactions/', TemplateView.as_view(template_name='index.html'), name='transactions'),
    path('', TemplateView.as_view(template_name='index.html'), name='home'),
] + static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
