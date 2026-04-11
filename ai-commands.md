# AI CLI Commands Reference

This file contains local automated workflows and macros for this repository. If you are a new developer or team member, you can use the AI CLI to read this document and natively execute these scripts without memorizing them!

To physically execute a workflow, simply run `ai run <command-name>` in your terminal.

---

## setup-project

Bootstraps the entire project for new team members. It will clear out old node_modules, do a fresh install, and start the development server.

```bash
rm -rf node_modules
npm install
npm run dev
```

## reset-db

Nukes the local developer postgres instances, restarts the containers, and generates fresh developer seed files. Helpful if you've corrupted your schema design during testing.

```bash
docker-compose down -v
docker-compose up -d postgres
npm run db:migrate
npm run db:seed
```

## deploy-prod

The absolute standard deployment architecture for our company. Ensure you pass CI linting before pushing!

```bash
npm run lint
npm run build
firebase deploy
```

## check-status

A quick macro to view our Git and Docker deployment statuses sequentially.

```bash
git status
docker ps -a
```

## push-all
Push all changes

```bash
git add .
git commit
git push
```

