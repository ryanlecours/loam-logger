import { Link } from 'react-router-dom';
import { motion } from "motion/react"

export default function Home() {
  return (
    <div className="bg-loam-gradient min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-4xl font-bold mb-4">LoamLogger</h1>
        <p className="text-l mb-8">
          Track your mountain bike rides, monitor your gear, and log your time in the loam.
        </p>
        <motion.div
          whileHover={{
            scale: 1.1,
            transition: { duration: 0.1 }
          }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.5 }}>
          <Link
            to="/login"
            className="btn-primary"
          >
            Log In
          </Link>
        </motion.div>
      </div>
    </div>
  );
}