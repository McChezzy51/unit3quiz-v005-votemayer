# unit3quiz-v005-votemayer

A small React + Vite site that:

- Loads `public/data/overdoseRates.csv` and plots a monthly line chart of **total overdose deaths**
- Cites the source dataset: [Provisional drug overdose death counts for specific drugs (Data.gov)](https://catalog.data.gov/dataset/provisional-drug-overdose-death-counts-for-specific-drugs)
- Includes a simple **“Vote Mayer for Mayor”** voting widget (in favor / against) backed by **Firebase Firestore** (optional)

## Run locally

```bash
npm install
npm run dev
```

## Firebase (optional, for voting)

Voting is enabled only when these env vars are set:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

If they’re missing, the chart still works and voting is disabled.
