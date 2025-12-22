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
      </footer>
    </main>
  );
}