export const appConfig = {
  databasePath: process.env.DATABASE_PATH ?? "./data/aniflow.sqlite",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Aniflow"
};
