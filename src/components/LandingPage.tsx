import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { CaliWordmark } from "./CaliWordmark";
import { SiteFooter } from "./SiteFooter";
import { ThemePicker } from "../theme/ThemePicker";
import { clearAuthRedirectError, initialAuthRedirectError, startGoogleSignIn } from "../lib/supabase";
import "./entry.css";

export function LandingPage() {
  const location = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState(initialAuthRedirectError);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const authDialogRef = useRef<HTMLDialogElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = authDialogRef.current;
    if (!authError || !dialog) return;
    dialog.showModal();
    retryButtonRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, [authError]);

  function dismissAuthError() {
    setAuthError(null);
    clearAuthRedirectError();
  }

  function scrollToTop() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
  }

  useEffect(() => {
    if (!location.hash) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(location.hash.slice(1))
        ?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    function handleResize() {
      if (window.innerWidth > 800) setMenuOpen(false);
    }
    function handlePointerDown(event: PointerEvent) {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !menuButtonRef.current?.contains(event.target as Node)
      )
        setMenuOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [menuOpen]);

  async function signIn() {
    if (authError) dismissAuthError();
    setError("");
    setBusy(true);
    try {
      await startGoogleSignIn();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect to Google. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="entry-page">
      <a className="entry-skip" href="#main">
        Skip to content
      </a>
      {authError && <dialog ref={authDialogRef} className="signout-dialog auth-error-dialog" aria-labelledby="auth-error-title" aria-describedby="auth-error-description" onCancel={(event) => { event.preventDefault(); dismissAuthError(); }}>
        <div className="signout-dialog-content">
          <p className="signout-dialog-kicker">ACCOUNT ACCESS</p>
          <h2 id="auth-error-title">{authError.code === 'access_denied' ? 'Use your RTU Google account' : "Google sign-in didn't finish"}</h2>
          <p id="auth-error-description" className="auth-error-description">{authError.code === 'access_denied' ? 'Cali is available to students with a verified @rtu.edu.ph Google account. Choose that account to continue.' : authError.description || 'Please try signing in again.'}</p>
          <div className="signout-dialog-actions">
            <button type="button" className="signout-cancel" onClick={dismissAuthError}>Close</button>
            <button ref={retryButtonRef} type="button" className="button-primary" onClick={() => { void signIn(); }} disabled={busy}>{busy ? 'Connecting...' : 'Choose another account'}</button>
          </div>
        </div>
      </dialog>}
      <header className="entry-header">
        <div className="entry-container entry-header-inner">
          <Link
            className="entry-home"
            to="/"
            onClick={scrollToTop}
            aria-label="CALI home"
          >
            <CaliWordmark />
          </Link>
          <button
            ref={menuButtonRef}
            className="entry-menu-toggle"
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="entry-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="entry-menu-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
          <div
            ref={menuRef}
            className={`entry-menu${menuOpen ? " entry-menu--open" : ""}`}
            id="entry-menu"
          >
            <nav aria-label="Main navigation">
              <a href="#features" onClick={() => setMenuOpen(false)}>
                Features
              </a>
              <a href="#how-it-works" onClick={() => setMenuOpen(false)}>
                Get started
              </a>
              <a href="#about" onClick={() => setMenuOpen(false)}>
                About
              </a>
            </nav>
            <div className="entry-header-actions">
              <ThemePicker />
              <button
                className="entry-header-cta"
                onClick={() => {
                  setMenuOpen(false);
                  void signIn();
                }}
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? "Connecting…" : "Try Cali for free"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main id="main">
        <section
          className="entry-hero entry-container"
          aria-labelledby="landing-title"
        >
          <div className="entry-hero-copy">
            <p className="entry-eyebrow">Your academics, organized.</p>
            <h1 id="landing-title">
              Make space for <em>better study habits.</em>
            </h1>
            <p className="entry-summary">
              Organize your classes, manage your tasks, and create study
              materials in one workspace built for RTU students.
            </p>
            {error && (
              <p className="form-error entry-hero-error" role="alert">
                {error}
              </p>
            )}
            <div className="entry-hero-actions">
              <button
                className="entry-google-primary"
                onClick={signIn}
                disabled={busy}
                aria-busy={busy}
              >
                <span>
                  {busy ? "Connecting to Google…" : "Continue with Google"}
                </span>
              </button>
              <a className="entry-text-link" href="#features">
                Explore features
              </a>
            </div>
            <p className="entry-auth-note">
              Use your institutional email to create your Cali account.
            </p>
          </div>
        </section>

        <section
          className="entry-section entry-features entry-container"
          id="features"
          aria-labelledby="features-title"
        >
          <div className="entry-section-intro">
            <p className="entry-kicker">01 / FEATURES</p>
            <h2 id="features-title">
              Less juggling.
              <br />
              <em>More doing.</em>
            </h2>
            <p>
              Plan your week, manage your coursework, and keep your study
              materials organized.
            </p>
          </div>
          <div className="entry-feature-grid">
            <article className="entry-feature">
              <span className="entry-feature-index">01 / SCHEDULE</span>
              <h3>See the whole week.</h3>
              <p>
                Find your class times and meeting details in one weekly view.
              </p>
            </article>
            <article className="entry-feature">
              <span className="entry-feature-index">02 / TASKS</span>
              <h3>Stay on top of tasks.</h3>
              <p>Organize assignments and deadlines alongside your classes.</p>
            </article>
            <article className="entry-feature">
              <span className="entry-feature-index">03 / STUDY</span>
              <h3>Study your way.</h3>
              <p>
                Create reviewers, flashcards, and quizzes from your own notes
                and files.
              </p>
            </article>
            <article className="entry-feature">
              <span className="entry-feature-index">04 / CALI COMMUNITY</span>
              <h3>Share reviewers.</h3>
              <p>
                Share and discover reviewers created by fellow RTU students.
              </p>
            </article>
          </div>
        </section>

        <section
          className="entry-how"
          id="how-it-works"
          aria-labelledby="how-title"
        >
          <div className="entry-container entry-how-inner">
            <div className="entry-how-heading">
              <p className="entry-kicker">02 / GET STARTED</p>
              <h2 id="how-title">
                Your academic space starts <em>with you.</em>
              </h2>
              <p>Set up your profile once, then get started with Cali.</p>
            </div>
            <ol className="entry-steps">
              <li>
                <span aria-hidden="true">STEP 1</span>
                <h3>Sign in with your institutional email</h3>
                <p>Choose your @rtu.edu.ph Google account.</p>
              </li>
              <li>
                <span aria-hidden="true">STEP 2</span>
                <h3>Make your profile</h3>
                <p>Add a username, program, and year level.</p>
              </li>
              <li>
                <span aria-hidden="true">STEP 3</span>
                <h3>Open your workspace</h3>
                <p>
                  View your classes, manage tasks, and start building your study
                  sets.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section
          className="entry-about entry-container"
          id="about"
          aria-labelledby="about-title"
        >
          <div>
            <p className="entry-kicker">03 / ABOUT CALI</p>
            <h2 id="about-title">
              A class ally.
              <br />
              <em>A space of your own.</em>
            </h2>
          </div>
          <div className="entry-about-right">
            <p>
              Cali is an academic workspace for RTU students, bringing classes, tasks, study tools, and reviewer sharing together in one place.
            </p>
            <button
              className="entry-google-primary entry-bottom-cta"
              onClick={signIn}
              disabled={busy}
              aria-busy={busy}
            >
              <span>
                {busy ? "Connecting to Google…" : "Get started with your institutional email"}
              </span>
            </button>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
