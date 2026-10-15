import { motion } from "motion/react";
import React from "react";
import { Link } from "react-router";

type Variant = "primary" | "secondary" | "outline";
type Size = "sm" | "default" | "lg";

type MotionButtonProps = React.ComponentPropsWithoutRef<typeof motion.button>;

interface ButtonProps extends Omit<MotionButtonProps, "variant"> {
  variant?: Variant;
  size?: Size;
}

// Shared by Button and LinkButton so a link styled as a button looks, moves
// and focuses exactly like one.
const pressMotion = {
  whileHover: { scale: 1.07 },
  whileTap: { scale: 0.95 },
  transition: { type: "spring", stiffness: 300, damping: 15 },
} as const;

function buttonClasses(variant: Variant, size: Size, className: string): string {
  const base =
    "cursor-pointer font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2";

  const sizeClasses = (() => {
    switch (size) {
      case "sm":
        return "btn-sm";
      case "lg":
        return "btn-lg";
      default:
        return "px-4 py-2";
    }
  })();

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
    }
  })();

  return `${base} ${sizeClasses} ${variantClasses} ${className}`;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, className = "", variant = "primary", size = "default", ...props }, ref) => (
    <motion.button
      ref={ref}
      {...pressMotion}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {children}
    </motion.button>
  )
);

Button.displayName = "Button";

const MotionLink = motion.create(Link);

type MotionLinkProps = React.ComponentPropsWithoutRef<typeof MotionLink>;

interface LinkButtonProps extends Omit<MotionLinkProps, "variant"> {
  variant?: Variant;
  size?: Size;
}

/** A router link that looks and behaves like Button, for navigation actions. */
export const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  ({ children, className = "", variant = "primary", size = "default", ...props }, ref) => (
    <MotionLink
      ref={ref}
      {...pressMotion}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {children}
    </MotionLink>
  )
);

LinkButton.displayName = "LinkButton";
