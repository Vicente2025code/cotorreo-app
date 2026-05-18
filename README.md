# cotorreo-app

Sistema de reservas para Grupo Cotorreo: Alpadel (canchas de pádel) y Plaza Cotorreo (restaurante).

## Roles y accesos

| Rol | Acceso |
|---|---|
| Cliente | Público sin PIN, ruta `/cliente.html` |
| Gerencia | PIN propio, todo + dashboard financiero |
| Operación | PIN propio, reservas, paquetes, recurrentes, cumples, facturación maestros |
| Maestros | PIN propio, solo sus reservas y facturación |
| Restaurante | PIN colectivo para saloneros, capturar reservas y marcar estados |

PINs específicos se configuran en variables de entorno del deploy (ver `.env.example`).

## Stack

- **Backend**: Node.js 20+ con Express
- **Storage**: Airtable como backend (vía REST API, PAT del lado servidor)
- **Auth**: PIN → JWT (válido 24h)
- **Frontend**: HTML + vanilla JS + CSS, mobile-first
- **Deploy**: Render — `reservas.grupocotorreo.com`

## Variables de entorno

Ver `.env.example`.

## Desarrollo local

```bash
npm install
cp .env.example .env
# Editar .env con valores reales
npm run dev
```

App en `http://localhost:3000`.

## Estructura

```
server/
├── index.js          # Express + servir frontend
├── airtable.js       # Cliente Airtable (centraliza PAT)
├── auth.js           # PIN → JWT, rate limiting
└── routes/
    ├── public.js     # Cliente (disponibilidad + crear reserva)
    ├── lili.js       # Operación
    ├── maestro.js    # Vistas individuales por maestro
    └── gerencia.js   # Dashboard $$

public/
├── index.html        # Landing
├── cliente.html      # Form público
├── login.html        # Teclado PIN
├── lili.html
├── maestro.html
├── gerencia.html
└── restaurante.html
```

## Integraciones que NO se tocan

- **n8n**: 7 workflows existentes siguen funcionando (digests, recordatorios, cumpleaños, recurrentes, fan-out staff)
- **WATI**: templates aprobados se siguen disparando desde n8n
- **Bot WhatsApp** (Render `cotorreo-bot`): sigue siendo primer punto de contacto con cliente

Esta app es solo la **capa de UI** que reemplaza tocar Airtable directo.
