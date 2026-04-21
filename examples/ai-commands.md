# AI CLI Commands Reference

This file contains local automated workflows and macros for this repository. To execute a workflow, run `ai run <command-name>` in your terminal.

## setup
Install all dependencies and configure the development environment.

```bash
npm install
```

## dev
Start the development server with hot-reload.

```bash
npm run dev
```

## test
Run the full test suite.

```bash
npm test
```

## lint
Lint and auto-fix the codebase.

```bash
npx eslint src/ --fix
```

## deploy
Build for production and start the server.

```bash
npm run build
npm start
```

## reset
Nuke node_modules and reinstall from scratch.

```bash
Remove-Item -Recurse -Force node_modules, package-lock.json -ErrorAction SilentlyContinue
npm install
```

## db-reset
Tear down the database, run migrations, and seed fresh data.

```bash
docker-compose down -v
docker-compose up -d postgres
npm run db:migrate
npm run db:seed
```

## staging-deploy
Deploy the current branch to the staging environment.

```bash
git stash
git checkout staging
git merge main
npm run build
npm run deploy:staging
git checkout main
git stash pop
```
