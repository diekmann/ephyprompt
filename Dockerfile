FROM python:3-slim

RUN groupadd --system app && useradd --system --gid app --create-home app
WORKDIR /app
RUN python -m venv /opt/venv && chown -R app:app /opt/venv
USER app
RUN /opt/venv/bin/pip install --no-cache-dir --upgrade pip pymupdf
ENV PATH="/opt/venv/bin:$PATH"
COPY --chown=app:app ephyprompt.html .
COPY --chown=app:app proxy.py .
EXPOSE 3000
CMD ["python", "proxy.py"]
