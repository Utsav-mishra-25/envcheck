import os

# Python: os.environ[...], os.getenv(...), os.environ.get(...)
REDIS_URL = os.environ["REDIS_URL"]
BROKER_URL = os.environ['CELERY_BROKER_URL']
SENTRY_DSN = os.getenv("SENTRY_DSN")
CONCURRENCY = int(os.getenv('WORKER_CONCURRENCY', '4'))
DEBUG = os.environ.get("WORKER_DEBUG")
