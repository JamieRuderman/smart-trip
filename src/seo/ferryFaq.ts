import {
  weekdayFerries,
  weekendFerries,
  weekdayInboundFerries,
  weekendInboundFerries,
} from "@/data/generated/ferrySchedule.generated";
import { FERRY_FARE_PARAMS } from "@/lib/fareConstants";
import { calculateTimeDifference } from "@/lib/timeUtils";
import type { Lang } from "./constants";
import { translator } from "./i18n";

function typicalCrossingMinutes(): number | null {
  const counts = new Map<number, number>();
  for (const { depart, arrive } of [
    ...weekdayFerries,
    ...weekendFerries,
    ...weekdayInboundFerries,
    ...weekendInboundFerries,
  ]) {
    const minutes = calculateTimeDifference(depart, arrive);
    counts.set(minutes, (counts.get(minutes) ?? 0) + 1);
  }
  let typical: number | null = null;
  for (const [minutes, count] of counts) {
    if (typical == null || count > counts.get(typical)!) typical = minutes;
  }
  return typical;
}

/** Google only honors FAQPage markup that matches the FAQ shown on the page. */
export function ferryFaq(lang: Lang): { question: string; answer: string }[] {
  const t = translator(lang);
  const minutes = typicalCrossingMinutes();
  return [
    {
      question: t("seo.ferry.faq.cost.q"),
      answer: t("seo.ferry.faq.cost.a", FERRY_FARE_PARAMS),
    },
    ...(minutes == null
      ? []
      : [
          {
            question: t("seo.ferry.faq.smart.q"),
            answer: t("seo.ferry.faq.smart.a", { minutes }),
          },
        ]),
  ];
}
