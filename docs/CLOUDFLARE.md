# Cloudflare أمام Railway

يُستخدم Cloudflare في هذه المنصة فقط كطبقة أمنية/شبكية وتخزين كائنات عند الحاجة. يبقى Next.js وGraphile Worker وPostgreSQL وAI runtime على Railway.

## الاستخدامات المسموحة

- DNS / Proxy / WAF وDDoS protection.
- Turnstile عندما يكون مفعّلًا.
- R2 لتخزين المرفقات مع روابط رفع موقعة.
- CDN/static delivery حيث يكون مناسبًا.

## مسار AI

لا يمر أي طلب AI عبر Cloudflare AI Gateway أو Workers AI أو bindings خاصة بالذكاء الاصطناعي. المسار الوحيد هو:

`Application → Provider Adapter → OpenAI / Anthropic / Gemini / OpenAI-compatible provider`

لا تضبط عناوين AI Gateway أو headers أو aliases تعتمد على Cloudflare. مفاتيح المزودات تحفظ ضمن آلية BYOK المشفرة الحالية.

## R2

في الإنتاج يجب ضبط `OBJECT_STORAGE_DRIVER=r2` مع بيانات R2. لا تمر bytes الملف عبر خادم التطبيق في المسار الطبيعي؛ يُحجز سجل الملف، يُرفع مباشرة إلى R2، ثم يُتحقق منه ويُعالج في الـworker.

## Proxy وTurnstile

لا تفعّل `TRUST_CLOUDFLARE_PROXY=true` إلا بعد منع تجاوز Cloudflare والوصول المباشر إلى origin. لا تُضعف Turnstile أو WAF أو rate limits عند تغيير AI runtime.
