FROM python:3-slim

RUN groupadd --system app && useradd --system --gid app --create-home app
WORKDIR /app
RUN python -m venv /opt/venv && chown -R app:app /opt/venv
USER app
ENV PATH="/opt/venv/bin:$PATH"
COPY --chown=app:app proxy.py .
COPY --chown=app:app ephyprompt.html favicon.ico style.css .
COPY --chown=app:app model-discovery.js pdf-rasterize-worker.js app.js startup-config.js .
COPY --chown=app:app node_modules/ ./node_modules/
EXPOSE 3000
CMD ["python", "proxy.py"]
