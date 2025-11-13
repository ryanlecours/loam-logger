import { Link } from 'react-router-dom';
import { motion } from "motion/react"
import AboutAppModal from '../components/AboutAppModal';

export default function Home() {
  return (
    <main className="bg-loam-gradient min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold mb-4">LoamLogger</h1>
        <p className="text-l mb-8">
          Track your mountain bike rides, monitor your gear, and log your time in the loam.
        </p>
        <div className="max-w-fit mx-auto">
        <motion.div
          whileHover={{
            scale: 1.1,
            transition: { duration: 0.1 }
          }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.5 }}
          className="max-w-fit">
          <Link
            to="/login"
            className="btn-primary"
          >
            Log In
          </Link>
        </motion.div>
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