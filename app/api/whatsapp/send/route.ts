import { NextResponse } from "next/server";

import { getReminderKey, hasWhatsAppConfig, sendWhatsAppMessage, shouldSkipReminder } from "@/lib/whatsapp";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const studentId = String(body.studentId ?? "");
    const guardianPhone = String(body.guardianPhone ?? "");
    const messageType = String(body.messageType ?? "monthly_reminder");
    const month = String(body.month ?? "");
    const messageContent = String(body.messageContent ?? "");

    if (!hasWhatsAppConfig()) {
      return NextResponse.json({ error: "WhatsApp configuration is missing." }, { status: 500 });
    }

    if (!studentId || !messageContent.trim()) {
      return NextResponse.json({ error: "Missing required message data." }, { status: 400 });
    }

    if (shouldSkipReminder(studentId, month, messageType as "payment_confirmation" | "monthly_reminder")) {
      return NextResponse.json({ status: "duplicate", message: "This reminder was already sent recently." }, { status: 200 });
    }

    if (!guardianPhone) {
      return NextResponse.json({ error: "No guardian phone was supplied." }, { status: 400 });
    }

    const result = await sendWhatsAppMessage({
      to: guardianPhone,
      message: messageContent,
    });

    return NextResponse.json({
      ok: true,
      status: "sent",
      reminderKey: getReminderKey(studentId, month, messageType as "payment_confirmation" | "monthly_reminder"),
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("WhatsApp send error:", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to send WhatsApp message.",
    }, { status: 500 });
  }
}
