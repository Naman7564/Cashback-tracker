from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('tracker.urls')),
    path('todo/', TemplateView.as_view(template_name='index.html'), name='todo'),
    path('cards/', TemplateView.as_view(template_name='index.html'), name='cards'),
    path('offers/', TemplateView.as_view(template_name='index.html'), name='offers'),
    path('', TemplateView.as_view(template_name='index.html'), name='home'),
]
