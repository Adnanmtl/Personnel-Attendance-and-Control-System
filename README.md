# PDKS Attendance Backend Service

A Personnel Attendance Control System (PDKS) backend service built with **Node.js**, **Express**, **PostgreSQL**, and **Docker Compose**.

---

## 🛠 Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL
- **Containerization**: Docker & Docker Compose

---

## 📁 Project Structure

```text
attendance-backend/
├── app/                  # Express REST API application
│   ├── index.js          # API endpoints & application logic
│   ├── Dockerfile        # Container definition for Node.js API
│   ├── package.json      # Dependencies and scripts
│   └── public/           # Static frontend files (HTML/CSS/JS)
├── db-init/              # PostgreSQL database initialization scripts
│   └── init.sql          # DB schema & seed data
├── docker-compose.yml    # Docker services orchestrator
├── .env.example          # Template environment variables
└── README.md             # Project documentation
```

---

## 🚀 Quick Start

### 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed & running
- Node.js (v18+) (optional for local running)

### 2. Environment Setup

Copy `.env.example` files to `.env`:

```bash
cp .env.example .env
cp app/.env.example app/.env
```

### 3. Run with Docker Compose

Start all services (API and PostgreSQL):

```bash
docker-compose up --build -d
```

### 4. Access Services

- **Web Panel / Direct API Access**: [http://localhost](http://localhost) or [http://localhost:3000](http://localhost:3000)
- **Database**: Port `5432`

---

## 🔒 Security Best Practices

- **Secrets**: Never commit `.env` files.
- **Node Modules**: Dependencies are managed inside containers; do not commit `node_modules/`.

---

## 📜 License

ISC / Internal Project

