# سياسة التحديث

1. فرع مستقل وتدقيق changelog وbreaking changes.
2. تحديث Adapter والخدمات والعقود معًا.
3. migration جديدة فقط؛ لا تعديل migration مطبقة.
4. تحديث UI والاختبارات والوثائق و`.env.example`.
5. تشغيل lint وtypecheck وtests وbuild.
6. مراجعة خاصة لتحديثات Next.js وReact وDrizzle وZod.
7. لا دمج major تلقائيًا، ولا دمج قبل CI.

عند فشل migration إنتاجية يكون الحل forward-fix بملف migration تالٍ. rollback للكود لا يحذف أعمدة أو بيانات أضيفت.
