export type WhatsAppMessageType = "payment_confirmation" | "monthly_reminder";

const recentReminderCache = new Map<string, number>();

export function normalizeWhatsAppNumber(rawNumber?: string | null) {
  if (!rawNumber) return null;

  const digits = rawNumber
    .replace(/\s+/g, "")
    .replace(/[^\d+]/g, "")
    .trim();

  if (!digits) return null;

  const withoutPlus = digits.replace(/^\+/, "");

  if (digits.startsWith("+212")) {
    return `+212${digits.slice(4).replace(/^0+/, "")}`;
  }

  if (withoutPlus.startsWith("212")) {
    return `+212${withoutPlus.slice(3).replace(/^0+/, "")}`;
  }

  if (digits.startsWith("0") && digits.length === 10) {
    return `+212${digits.slice(1)}`;
  }

  if (digits.startsWith("+")) return digits;

  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }

  return `+${withoutPlus}`;
}

export function getMonthLabel(monthKey: string) {
  if (!monthKey) return "";

  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;

  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("ar-MA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function buildPaymentConfirmationMessage({
  guardianName,
  studentName,
  amountPaid,
  month,
  paymentDate,
}: {
  guardianName: string;
  studentName: string;
  amountPaid: number;
  month: string;
  paymentDate: string;
}) {
  return [
    `السلام عليكم ${guardianName}،`,
    `نخبركم أنه تم تسجيل أداء ${Number(amountPaid).toLocaleString("fr-FR")} درهم لفائدة التلميذ(ة) ${studentName} عن شهر ${getMonthLabel(month)} بتاريخ ${new Date(`${paymentDate}T00:00:00Z`).toLocaleDateString("ar-MA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })}.`,
    "شكراً لثقتكم بمركز سنابل الكوثر.",
  ].join("\n");
}

export function buildMonthlyReminderMessage({
  guardianName,
  studentName,
  month,
}: {
  guardianName: string;
  studentName: string;
  month: string;
}) {
  return [
    `السلام عليكم ${guardianName}،`,
    `هذا تذكير بأن موعد أداء واجب الدراسة للتلميذ(ة) ${studentName} عن شهر ${getMonthLabel(month)} اقترب.`,
    "شكراً لتعاونكم وثقتكم بمركز سنابل الكوثر.",
  ].join("\n");
}

export function getReminderKey(studentId: string, monthKey: string, type: WhatsAppMessageType) {
  return `${studentId}:${monthKey}:${type}`;
}

export function shouldSkipReminder(studentId: string, monthKey: string, type: WhatsAppMessageType) {
  const key = getReminderKey(studentId, monthKey, type);
  const now = Date.now();
  const previous = recentReminderCache.get(key);

  if (previous && now - previous < 24 * 60 * 60 * 1000) {
    return true;
  }

  recentReminderCache.set(key, now);
  return false;
}

export async function sendWhatsAppMessage({
  to,
  message,
}: {
  to: string;
  message: string;
}) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp configuration is missing.");
  }

  const normalizedNumber = normalizeWhatsAppNumber(to);
  if (!normalizedNumber) {
    throw new Error("The phone number is invalid or missing.");
  }

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedNumber,
      type: "text",
      text: {
        body: message,
        preview_url: false,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || "The WhatsApp API request failed.");
  }

  return {
    ok: true,
    messageId: data?.messages?.[0]?.id ?? null,
  };
}

export function hasWhatsAppConfig() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  );
}
