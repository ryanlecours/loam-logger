import { motion } from "motion/react";
import React from "react";

type MotionButtonProps = React.ComponentPropsWithoutRef<typeof motion.button>;

interface ButtonProps extends Omit<MotionButtonProps, "variant"> {
  variant?: "primary" | "secondary" | "outline";
  size?: "sm" | "default";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, className = "", variant = "primary", size = "default", ...props }, ref) => {
    const base =
      "cursor-pointer font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2";

    const sizeClasses = size === "sm" ? "btn-sm" : "px-4 py-2";

    const variantClasses = (() => {
      switch (variant) {
        case "primary":
          return "btn-primary";
        case "secondary":
          return "btn-secondary";
        case "outline":
            return "btn-outline";
        default:
          return "";
      }})();

    return (
      <motion.button
        ref={ref}
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 15 }}
        className={`${base} ${sizeClasses} ${variantClasses} ${className}`}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);

Button.displayName = "Button";
