function env(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export const appConfig = {
  databasePath: env("DATABASE_PATH", "./data/aniflow.sqlite"),
  appName: env("NEXT_PUBLIC_APP_NAME", "Aniflow"),
  /**
   * When set, the web UI and APIs require login.
   * Leave empty for open local access (default).
   */
  authPassword: env("AUTH_PASSWORD"),
  /**
   * HMAC secret for session cookies. Falls back to a derived value from AUTH_PASSWORD.
   */
  authSecret:
    env("AUTH_SECRET") ||
    (env("AUTH_PASSWORD")
      ? `aniflow:${env("AUTH_PASSWORD")}:session`
      : "aniflow-dev-secret")
};
