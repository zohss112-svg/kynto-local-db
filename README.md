# 🚀 Kynto – Your Local Database Companion

> **SQL Management.** Done locally. No cloud. No bills. Just your data.

Kynto is a lightweight database client built for developers who want control. Run PostgreSQL queries, explore your data, and build REST APIs—all on your machine. **Still early, but growing.**

**[→ Getting Started](#quick-start)** • [→ Why Kynto?](#why-local-first) • Development Stage: **Beta**

---

## What is Kynto?

Tired of cloud databases taking a cut? Kynto runs entirely on your laptop. Connect to **PostgreSQL**, use embedded **PGlite**, or sync local data. Write SQL, explore schemas, generate APIs—no terminal wizardry required.

Supabase started as the open-source alternative to Firebase, but they eventually ended up in the same place: the Cloud. If you want real control, you still have to rent their infrastructure.

**The Problem:** Platforms like Firebase and Supabase tie you to their servers. You are trading vendor lock-in for cloud dependency. The latency remains, monthly costs scale with your success, and your data sovereignty ends at their API.

**The Solution:** Kynto is the local-first alternative.

I built Kynto to bring the speed and simplicity of these platforms to your own machine (or your own server). You can use your own PostgreSQL instance without a third party sitting between you and your data.

This isn't just about being another database tool—it's about decoupling the modern developer workflow from the cloud and making it available locally. Full infrastructure control, zero cloud latency, and true data sovereignty.

Kynto is currently in Beta, and I’m looking for feedback from anyone who wants to own their infrastructure again. What is your biggest pain point when trying to move away from managed cloud databases?

**We're just getting started.** Expect rough edges, but also expect simplicity.

---

## Why Local First?

Firebase is a black box. We are local and open source.

**Kynto vs Supabase.** Simple story:

| | Kynto | Supabase | Firebase |
|---|---|---|---|
| **Data Lives Where?** | Your laptop | Their servers | Google's servers |
| **Query Speed** | Instant (same machine) | Network latency | Network latency |
| **Cost** | Free | Pay per query | Pay per operation |
| **Need Internet?** | Nope | Yep | Yep |
| **Who Owns Your Data?** | You | Technically you, but... | Google |

No cloud lock-in. No monthly surprises. Your database, your rules.

---

## What Can You Do?

✨ **Write SQL.** See results instantly. No waiting for cloud responses.

📊 **Visualize Data.** Charts, type highlighting, entity relationships—enough to understand your schema.

🔄 **Sync It.** Connect a remote PostgreSQL, sync local changes. Still building this one.

🤖 **Ask the AI.** Tell it what you need. It generates SQL. (Requires local Ollama, but hey—free LLM.)

🌐 **Generate APIs.** Auto-create REST endpoints from your tables. Local server, instant.

📥 **Import Data.** CSV, JSON, SQL dumps. Drag, drop, done.

**That's it.** We're not trying to be everything. We're trying to be fast and yours.

---

## Quick Start

### What You Need
- **Node.js** 18+  
- **npm** (comes with Node.js)

### Run It

```bash
git clone <repo>
cd kynto
npm install
npm start
```

**That's it.** Open the app, pick a database, write SQL.

---

## Roadmap (Beta)

- ✅ Query editor
- ✅ Local data visualization  
- ✅ Basic REST API generation
- 🚧 Better sync (PostgreSQL ↔ Local)
- 🚧 Advanced charts
- 🚧 Collaborative features

We're building this in the open. What do **you** need?

---

## Contribute

This is **my project.** I own it completely. But I'd love your help.

Found a bug? Got an idea? Want to build something? Send a PR or reach out. No complicated processes. Just real collaboration.

---

<div align="center">

Made with ❤️ by someone tired of cloud bills.

**Still in beta. Still improving. Always honest.**

</div>
