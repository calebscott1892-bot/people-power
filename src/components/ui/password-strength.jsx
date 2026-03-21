import * as React from "react";
import { cn } from "@/lib/utils";

function scorePassword(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

const labels = ["", "Weak", "Fair", "Good", "Strong"];
const colors = ["", "bg-red-500", "bg-amber-500", "bg-emerald-400", "bg-emerald-500"];

export function PasswordStrength({ password }) {
  const score = scorePassword(password);

  if (!password) return null;

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              i <= score ? colors[score] : "bg-slate-200"
            )}
          />
        ))}
      </div>
      <div className={cn(
        "text-xs font-medium transition-colors",
        score <= 1 ? "text-red-600" : score === 2 ? "text-amber-600" : "text-emerald-600"
      )}>
        {labels[score]}
      </div>
    </div>
  );
}
