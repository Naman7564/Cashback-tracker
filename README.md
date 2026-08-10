# Cashback Tracker

Personal-use mobile-first web app to track bank/UPI cashback offers and transactions.

## Tech Stack

- **Backend:** Django 5 + Django REST Framework
- **Frontend:** Vanilla JS + Tailwind CSS (CDN)
- **Database:** SQLite3
- **Deployment:** Docker + Docker Compose

## Quick Start

```bash
# Local
python -m venv venv
source venv/Scripts/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
mkdir -p db
python manage.py migrate
python manage.py runserver
# Open http://127.0.0.1:8000

# Docker
docker compose up --build
# Open http://localhost:8000
```

## Features

- **Home Dashboard** — Pending cashback, earned this month, best source, recent transactions
- **Transactions** — Full CRUD with filters (month, status, source), auto-cashback calculation
- **Cards & UPI** — Manage payment sources with color tags, active/inactive toggle
- **Offers** — Track active offers with expiry alerts, percentage/flat cashback types

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET/POST /api/sources/` | Payment sources CRUD |
| `GET/POST /api/offers/` | Offers CRUD (filter: `source`, `category`, `is_active`) |
| `GET/POST /api/transactions/` | Transactions CRUD (filter: `source`, `status`, `statement_month`) |
| `POST /api/calculate-cashback/` | Auto-calculate cashback `{source_id, amount, category}` |
| `GET /api/dashboard-stats/` | Dashboard summary stats |

## Design System

"Indigo Ledger" — designed via Google Stitch.

- **Primary:** Indigo `#4F46E5`
- **Success:** Emerald `#10b981`
- **Warning:** Amber `#f59e0b`
- **Font:** Inter
- **Layout:** Mobile-first (375px), bottom nav, card-based UI
