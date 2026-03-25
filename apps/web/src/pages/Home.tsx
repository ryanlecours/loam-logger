import { Link } from 'react-router-dom';
import AboutAppModal from '../components/AboutAppModal';
import { Button } from '../components/ui';

export default function Home() {
  return (
    <main className="bg-loam-gradient min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold mb-4">LoamLogger</h1>
        <p className="text-l mb-8">
          Track your mountain bike rides, monitor your gear, and log your time in the loam.
        </p>
        <div className="mx-auto">
          <Button
            variant='primary'
            children={
              <Link to="/login">
                Log In
              </Link>
            }
          />
        </div>
        <AboutAppModal />
      </div>
      <footer className="mt-16 border-t border-black/10 py-6 text-sm dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="opacity-70">© {new Date().getFullYear()} Loam Logger</span>
          <nav className="flex gap-4">
            <a className="underline underline-offset-4" href="/privacy">Privacy Policy</a>
          </nav>
        </div>
        <div className="mt-6 pt-6 border-t border-black/10 dark:border-white/10">
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-concrete text-center">
              Bike specifications and component data
            </p>
            <a
              href="https://99spokes.com"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-80 hover:opacity-100 transition-opacity"
            >
              <img
                src="/logos/powered-by-99-spokes-for-dark-bg.svg"
                alt="Powered by 99 Spokes"
                className="h-8"
              />
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}