import { AlertTriangle } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

/** Gold callout above a tight train ↔ ferry transfer, suggesting the earlier or
 *  later train (`trainOption`). */
export function QuickConnectionWarning({ trainOption }: { trainOption: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 p-3 rounded-lg bg-smart-gold/10 border border-smart-gold/40 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 text-smart-gold mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-medium text-smart-gold">
          {t("quickConnection.quickTransferWarning")}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          <Trans
            i18nKey="quickConnection.message"
            values={{ trainOption }}
            components={{
              strong: <strong className="text-foreground" />,
            }}
          />
        </p>
      </div>
    </div>
  );
}
