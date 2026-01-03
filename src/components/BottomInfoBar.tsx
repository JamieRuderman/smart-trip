import { Bell } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

export function BottomInfoBar() {
  return (
    <div className="container max-w-4xl mx-auto px-3 md:px-0 pb-safe space-y-3">
      <div className="pt-12 mt-6 md:px-8 md:py-4 text-sm text-muted-foreground border-t md:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <Bell
            aria-hidden
            className="h-4 w-4 mt-0.5 shrink-0 text-foreground/70"
          />
          <p className="flex-grow">
            Receive Service Alerts by texting the word{" "}
            <span className="font-semibold">SMART</span> to
            <span className="font-semibold"> 888777</span> or{" "}
            <a
              href="https://member.everbridge.net/index/892807736728379#/login"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              click here
            </a>{" "}
            <span>to sign-up.</span>
          </p>
          <div className="-mb-4">
            <ThemeToggle />
          </div>
        </div>
        <p className="ml-7 mt-4 text-xs">
          Data provided by{" "}
          <a
            href="https://511.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            511.org
          </a>
          . This is an open-source community project and is not an official
          SMART app.
        </p>
      </div>
    </div>
  );
}

export default BottomInfoBar;
