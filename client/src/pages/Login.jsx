import { useEffect, useState } from "react";
import { useApp } from "../appContext.jsx";
import { signIn, getMe, setupFirstAdmin } from "../api.js";

// Sign-in, or on a brand new install (no accounts yet) the form that creates the first administrator.
export default function Login() {
  const { setUser } = useApp();
  const [setup, setSetup] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { getMe().then((r) => setSetup(Boolean(r.needs_setup))).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = setup ? await setupFirstAdmin({ display_name: name, email, password }) : await signIn(email, password);
      setUser(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>IHOP <span>Operations</span></h1>
        <p className="muted">
          {setup
            ? "Welcome. No one has an account yet, so start by creating the administrator. This person sees every restaurant and adds everyone else."
            : "Sales forecasting and operations dashboard. Sign in to see the restaurants you are responsible for."}
        </p>
        {setup && <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>}
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!setup} /></label>
        <label>Password{setup ? " (10 characters or more)" : ""}<input type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="alert err">{error}</div>}
        <button className="btn" type="submit" disabled={busy}>{busy ? "One moment…" : setup ? "Create administrator account" : "Sign in"}</button>
      </form>
    </div>
  );
}
