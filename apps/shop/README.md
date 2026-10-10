# ATELIER Market

A standalone, interview-ready React commerce experience for international consumers.

## Features

- Responsive desktop and mobile storefront
- Product search, category filters, and sorting
- Product quick view and color presentation
- Zustand-powered persistent shopping bag with quantity controls
- i18next configuration with English and Simplified Chinese
- Free-shipping progress and demo checkout
- No login, backend, or database required
- Independent Docker deployment on port `4173`

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Docker deployment

```bash
docker compose up -d --build
```

Open `http://localhost:4173/shop/`.

To use another port:

```bash
SHOP_PORT=8088 docker compose up -d --build
```

If the deployment host cannot access the npm registry, build `dist` before transferring the project and use the runtime-only image:

```bash
docker build -f Dockerfile.runtime -t atelier-market:latest .
docker compose up -d --no-build
```

## Production note

All catalog data is currently mocked in `src/data/products.ts`. Cart state is versioned and stored in the browser's `localStorage`. The project has its own image, container, port, Nginx configuration, and Compose file, so it does not modify or depend on the existing blog project.

The production build uses `/shop/` as its public base path. `docker-compose.production.yml` joins the existing `myblog_backend` gateway network so the main reverse proxy can reach the independent container by its `atelier-market` alias.
