import type { LegalSlug } from '@da3wa/shared';

/**
 * The text the three documents start life with.
 *
 * It lives here rather than in `seed.ts` because the seed is not guaranteed to
 * run: one of the two live deployments seeds the catalogue only, and a box that
 * has run `db:deploy` but no seed would otherwise serve a 404 from the footer
 * link on its own landing page. `getLegalDocuments` upserts from this constant
 * on read, the same trick `getSettings` uses for branding.
 *
 * It is also not in `@default()` in the schema: forty lines of Arabic prose in a
 * column default is text nobody can review in a diff, and changing it would mean
 * a migration.
 *
 * Two deliberate choices in the wording:
 *
 * - It says «المنصة», never the brand name. The brand is operator-editable, so
 *   a default that hardcoded «دعوة» would start lying the moment someone
 *   renamed the product in the branding tab.
 * - Contact details are left as a visible blank, `[بريد الدعم]`. An invented
 *   support address in a published privacy policy is worse than an obvious gap:
 *   the gap gets filled, the invention gets shipped.
 *
 * This is a starting draft written to match what the product actually does. It
 * is not legal advice, and an operator should have it reviewed before trading
 * on it — particularly the refund terms, which are the ones that get disputed.
 */

const SUPPORT = '[بريد الدعم]';
const SUPPORT_EN = '[support email]';

const TERMS_AR = `تحكم هذه الشروط استخدامك للمنصة وخدماتها. باستخدامك المنصة أو إنشاء حساب عليها فإنك توافق على ما ورد فيها، فاقرأها قبل الاستخدام.

## التعريفات
- «المنصة»: الموقع والخدمات الرقمية المقدَّمة من خلاله.
- «المنظّم»: صاحب الحساب الذي ينشئ المناسبة ويضيف قائمة المدعوين.
- «المدعو»: الشخص الذي يتلقى رابط الدعوة من المنظّم.
- «المناسبة»: الحدث الذي ينشئه المنظّم على المنصة.

## الحساب
تسجيل الحساب يتطلب رقم جوال سعودي صحيح واسمًا حقيقيًا. أنت مسؤول عن سرية بيانات دخولك وعن كل نشاط يتم من خلال حسابك، وعليك إبلاغنا فورًا عند اشتباهك في أي استخدام غير مصرَّح به.

يجب ألا يقل عمرك عن ثمانية عشر عامًا لإنشاء حساب.

## طبيعة الخدمة
المنصة أداة لإنشاء الدعوات الرقمية وإرسالها وإدارة حضور المناسبات: إنشاء المناسبة، واستيراد قائمة المدعوين، وتوليد رابط دعوة خاص لكل مدعو، وتلقّي الردود وأعداد المرافقين، وتسجيل الحضور عند الباب عبر مسح رمز الاستجابة السريعة.

المنصة ليست منظّمًا للمناسبة ولا طرفًا فيها، ولا تقدّم خدمات القاعات أو الضيافة أو أي خدمة أخرى خارج ما هو موصوف أعلاه.

## الباقات والدفع
تُشترى الباقة لكل مناسبة على حدة، ويحدد سعرها وسقف عدد المدعوين فيها ما هو معروض في صفحة الأسعار وقت الشراء. جميع الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة ما لم يُذكر خلاف ذلك.

تُفعَّل الباقة بعد اكتمال الدفع. ولا يجوز نقل الباقة من مناسبة إلى أخرى بعد إرسال أول دعوة.

الاسترجاع تحكمه سياسة الاسترجاع المنشورة على المنصة، وهي جزء لا يتجزأ من هذه الشروط.

## مسؤولية المنظّم تجاه المدعوين
عند رفعك قائمة المدعوين فأنت تُقر بأنك حصلت على أرقامهم بطريقة مشروعة، وأن لك علاقة تبرر دعوتهم، وأنك تتحمل مسؤولية إرسال الدعوة إليهم.

أنت وحدك من يرسل الدعوات من رقم جوالك عبر واتساب؛ المنصة تُعِدّ الرسالة والرابط ولا ترسل نيابة عنك ولا تملك اتصالًا بحساب واتساب الخاص بك.

فيما يخص بيانات المدعوين، تعمل المنصة بصفتها معالِجًا للبيانات نيابةً عنك، وتبقى أنت المتحكم بها.

## الاستخدام المقبول
يُمنع استخدام المنصة في:
- إرسال رسائل دعائية أو جماعية إلى أشخاص لا تربطك بهم دعوة فعلية.
- أي محتوى مخالف لأنظمة المملكة العربية السعودية أو مسيء أو منتهك لحقوق الغير.
- محاولة الوصول إلى حسابات أو بيانات لا تخصك، أو اختبار أو اختراق أمن المنصة.
- إعادة بيع الخدمة أو تأجيرها دون اتفاق مكتوب.

## الملكية الفكرية
المنصة وتصاميمها وقوالبها وبرمجياتها مملوكة لنا. ويرخَّص لك استخدام القوالب داخل المنصة لأغراض مناسبتك فقط، دون حق في إعادة بيعها أو توزيعها.

المحتوى الذي ترفعه — الأسماء والصور ونص الدعوة — يبقى ملكك، وتمنحنا ترخيصًا محدودًا لعرضه وتخزينه بالقدر اللازم لتشغيل الخدمة.

## توفر الخدمة
نبذل جهدًا معقولًا لإبقاء المنصة متاحة، دون أن نضمن استمرارية متصلة بلا انقطاع. وقد نجري صيانة مجدولة نسعى إلى تنفيذها خارج أوقات الذروة.

## حدود المسؤولية
لا نتحمل المسؤولية عن عدم وصول رسالة عبر واتساب أو عن أي خلل في خدمة طرف ثالث، ولا عن نجاح مناسبتك أو عدد الحاضرين فيها، ولا عن الأضرار غير المباشرة.

وفي جميع الأحوال لا تتجاوز مسؤوليتنا الإجمالية المبلغ الذي دفعته مقابل المناسبة محل النزاع.

## إيقاف الحساب
يجوز لنا إيقاف الحساب أو تعطيله عند مخالفة هذه الشروط أو عند الاشتباه في استخدام يضر بالمدعوين أو بالمنصة. وفي حالات المخالفة الجسيمة قد يتم الإيقاف دون إشعار مسبق.

يمكنك طلب حذف حسابك في أي وقت عبر التواصل معنا.

## تعديل الشروط
قد نعدّل هذه الشروط، ويسري التعديل من تاريخ نشره على هذه الصفحة. واستمرارك في استخدام المنصة بعد النشر يُعد قبولًا للنسخة المحدّثة.

## النظام الواجب التطبيق
تخضع هذه الشروط لأنظمة المملكة العربية السعودية، وتختص الجهات القضائية المختصة في المملكة بالفصل في أي نزاع ينشأ عنها.

## التواصل
لأي استفسار بخصوص هذه الشروط: ${SUPPORT}`;

const TERMS_EN = `These terms govern your use of the platform and its services. By using the platform or creating an account you agree to them, so please read them first.

## Definitions
- "Platform": the website and the digital services provided through it.
- "Host": the account holder who creates an event and adds the guest list.
- "Guest": the person who receives an invitation link from the host.
- "Event": the occasion the host creates on the platform.

## Your account
Registration requires a valid Saudi mobile number and a real name. You are responsible for keeping your credentials confidential and for all activity under your account, and you must tell us promptly if you suspect unauthorised use.

You must be at least eighteen years old to create an account.

## What the service is
The platform is a tool for creating and sending digital invitations and managing event attendance: creating the event, importing the guest list, generating a personal invitation link for each guest, collecting RSVPs and companion counts, and checking guests in at the door by scanning a QR code.

The platform is not the organiser of your event and is not a party to it. It provides no venue, catering, or any service beyond what is described above.

## Packages and payment
A package is bought per event; its price and guest cap are those shown on the pricing page at the time of purchase. All prices are in Saudi riyals and include VAT unless stated otherwise.

A package activates once payment completes. It cannot be moved to another event after the first invitation has been sent.

Refunds are governed by the refund policy published on the platform, which forms part of these terms.

## The host's responsibility towards guests
By uploading a guest list you confirm that you obtained those numbers lawfully, that you have a relationship that justifies inviting them, and that you take responsibility for sending them the invitation.

You alone send the invitations, from your own number over WhatsApp. The platform prepares the message and the link; it does not send on your behalf and has no connection to your WhatsApp account.

In respect of guest data the platform acts as a processor on your behalf, and you remain the controller.

## Acceptable use
You may not use the platform for:
- Marketing or bulk messages to people you have no genuine invitation for.
- Content that breaches the laws of the Kingdom of Saudi Arabia, is abusive, or infringes the rights of others.
- Attempting to reach accounts or data that are not yours, or probing the platform's security.
- Reselling or renting the service without a written agreement.

## Intellectual property
The platform, its designs, templates and software are ours. You are licensed to use the templates within the platform for your own event only, with no right to resell or redistribute them.

Content you upload — names, images, invitation wording — remains yours. You grant us a limited licence to store and display it as far as is needed to run the service.

## Availability
We make reasonable efforts to keep the platform available, without guaranteeing uninterrupted service. Scheduled maintenance is planned outside peak hours where we can.

## Limitation of liability
We are not liable for a WhatsApp message failing to arrive or for any fault in a third-party service, nor for the success of your event or the number of people who attend, nor for indirect losses.

In all cases our total liability will not exceed the amount you paid for the event in dispute.

## Suspension
We may suspend or disable an account that breaches these terms, or where we suspect use that harms guests or the platform. In cases of serious breach this may happen without prior notice.

You may ask us to delete your account at any time.

## Changes to these terms
We may amend these terms. An amendment takes effect from the date it is published on this page, and continuing to use the platform after publication counts as acceptance of the updated version.

## Governing law
These terms are governed by the laws of the Kingdom of Saudi Arabia, and the competent courts of the Kingdom have jurisdiction over any dispute arising from them.

## Contact
For any question about these terms: ${SUPPORT_EN}`;

const PRIVACY_AR = `توضح هذه السياسة ما نجمعه من بيانات، ولماذا نجمعه، وكيف نحفظه ومع من نشاركه. ونلتزم فيها بنظام حماية البيانات الشخصية في المملكة العربية السعودية ولائحته التنفيذية.

## البيانات التي نجمعها منك
- بيانات الحساب: الاسم ورقم الجوال وكلمة مرور مشفَّرة.
- بيانات المناسبة: عنوانها ونوعها وتاريخها ومكانها ونص الدعوة والتصميم المختار.
- بيانات الدفع: نتلقى من مزوّد الدفع حالة العملية ورقمها وآخر أربعة أرقام من البطاقة فقط. لا نحفظ رقم البطاقة الكامل ولا رمز التحقق في أي وقت.
- بيانات تقنية: عنوان الإنترنت ونوع المتصفح وسجلات الاستخدام، لأغراض الأمن ومعالجة الأعطال.

## بيانات المدعوين
عندما يرفع المنظّم قائمة المدعوين نعالج أسماءهم وأرقام جوالاتهم وردودهم وأعداد مرافقيهم ووقت تسجيل حضورهم.

في هذه البيانات يكون المنظّم هو المتحكم ونكون نحن المعالِج: نعالجها لتشغيل الخدمة نيابة عنه، ولا نستخدمها لأي غرض تسويقي خاص بنا، ولا نبيعها.

المدعو الذي يرغب في تعديل بياناته أو حذفها يمكنه التواصل مع المنظّم مباشرة، أو التواصل معنا فنحيل طلبه إليه.

## أساس المعالجة
نعالج بياناتك لتنفيذ العقد بيننا عند تقديم الخدمة، والالتزام بأنظمة المملكة فيما يخص الفوترة والاحتفاظ بالسجلات، ولمصلحة مشروعة في أمن المنصة ومنع إساءة الاستخدام.

## كيف نستخدم البيانات
- تشغيل الخدمة: إنشاء الدعوات وروابطها، وتلقّي الردود، وتسجيل الحضور، وإصدار التقارير للمنظّم.
- التواصل التشغيلي: رسائل نصية للتحقق من الرقم أو تنبيهات تخص مناسبتك.
- الأمن: كشف محاولات الدخول غير المصرَّح بها والحد من إساءة الاستخدام.
- الفوترة: إصدار الفواتير وحفظها بما يلزم نظامًا.

لا نرسل رسائل تسويقية إلى المدعوين إطلاقًا.

## مشاركة البيانات
لا نبيع البيانات الشخصية. ونشاركها في أضيق الحدود مع:
- مزوّد بوابة الدفع، لإتمام العملية.
- مزوّد الرسائل النصية، لإرسال رموز التحقق.
- مزوّد الاستضافة، بوصفه المكان الذي تعمل عليه المنصة.
- الجهات المختصة، متى طُلب ذلك بموجب نظام أو أمر قضائي.

## مكان الحفظ ومدته
تُحفظ البيانات على خوادم لدى مزوّد استضافة، وتُنقل عبر اتصال مشفَّر.

نحتفظ ببيانات المناسبة والمدعوين ما دام حساب المنظّم قائمًا، وله حذف مناسبته وقائمة مدعويها في أي وقت. وتُحفظ سجلات الفواتير للمدة التي توجبها الأنظمة المحاسبية والضريبية في المملكة.

## ملفات الارتباط
نستخدم ملفات ارتباط ضرورية فقط: بقاء جلستك مفتوحة، وتذكّر لغتك المختارة، وحماية النماذج. لا نستخدم ملفات ارتباط لتتبع إعلاني.

## حقوقك
لك حق العلم ببياناتك والوصول إليها والحصول على نسخة منها، وتصحيحها، وطلب إتلافها، وسحب موافقتك متى كانت المعالجة قائمة عليها. ولطلب أيٍّ من ذلك تواصل معنا على ${SUPPORT}، ونستجيب خلال ثلاثين يومًا.

وإذا لم تكن راضيًا عن استجابتنا فلك التقدّم بشكوى إلى الجهة المختصة بحماية البيانات في المملكة.

## أمن البيانات
كلمات المرور محفوظة بصيغة مشفَّرة لا يمكن عكسها، وروابط الدعوات ورموز الحضور موقَّعة بحيث لا يمكن تخمينها أو تزويرها، والوصول الإداري محصور ومسجَّل. ومع ذلك لا يمكن لأي نظام أن يَعِد بأمان مطلق.

## الأطفال
الخدمة موجَّهة لمن أتم الثامنة عشرة. وإذا وردت بيانات طفل ضمن قائمة مدعوين فهي على مسؤولية المنظّم ويقتصر استخدامها على إصدار دعوته.

## تعديل السياسة
قد نحدّث هذه السياسة، ويظهر تاريخ آخر تحديث أسفل هذه الصفحة. وعند إجراء تغيير جوهري نُشعر أصحاب الحسابات.

## التواصل
لأي استفسار أو طلب يخص بياناتك: ${SUPPORT}`;

const PRIVACY_EN = `This policy explains what data we collect, why, how we store it and who we share it with. It follows the Personal Data Protection Law of the Kingdom of Saudi Arabia and its implementing regulations.

## What we collect from you
- Account data: name, mobile number, and a hashed password.
- Event data: title, type, date, venue, invitation wording and the chosen design.
- Payment data: from the payment provider we receive the transaction status, its reference, and the last four digits of the card only. We never store a full card number or security code.
- Technical data: IP address, browser type and usage logs, for security and fault diagnosis.

## Guest data
When a host uploads a guest list we process guests' names, mobile numbers, RSVPs, companion counts and check-in times.

For this data the host is the controller and we are the processor: we process it to run the service on their behalf, we do not use it for any marketing of our own, and we do not sell it.

A guest who wants their data corrected or deleted can contact the host directly, or contact us and we will pass the request on.

## Legal basis
We process your data to perform our contract with you in providing the service, to comply with Saudi law on invoicing and record-keeping, and for a legitimate interest in the platform's security and the prevention of abuse.

## How we use data
- Running the service: creating invitations and their links, collecting RSVPs, checking guests in, and producing the host's reports.
- Operational messages: SMS to verify a number, or notices about your event.
- Security: detecting unauthorised access attempts and limiting abuse.
- Billing: issuing and retaining invoices as required.

We never send marketing messages to guests.

## Sharing
We do not sell personal data. We share it, as narrowly as possible, with:
- The payment gateway, to complete a transaction.
- The SMS provider, to deliver verification codes.
- The hosting provider, as the place the platform runs.
- Competent authorities, where required by law or court order.

## Where data is kept, and for how long
Data is held on servers at a hosting provider and travels over an encrypted connection.

We keep event and guest data for as long as the host's account exists, and a host may delete an event and its guest list at any time. Invoice records are kept for the period Saudi accounting and tax rules require.

## Cookies
We use strictly necessary cookies only: keeping your session open, remembering your chosen language, and protecting forms. We use no advertising or tracking cookies.

## Your rights
You have the right to be informed about your data, to access it and obtain a copy, to have it corrected, to request its destruction, and to withdraw consent where processing rests on it. To exercise any of these write to ${SUPPORT_EN}; we respond within thirty days.

If you are not satisfied with our response you may complain to the competent data protection authority in the Kingdom.

## Security
Passwords are stored hashed and cannot be reversed, invitation links and check-in codes are signed so they cannot be guessed or forged, and administrative access is restricted and logged. No system, however, can promise absolute security.

## Children
The service is intended for those aged eighteen and over. Where a child's details appear in a guest list, that is the host's responsibility and we use them only to issue that invitation.

## Changes to this policy
We may update this policy; the date of the last update appears at the foot of this page. Where a change is material we notify account holders.

## Contact
For any question or request about your data: ${SUPPORT_EN}`;

const REFUND_AR = `توضح هذه السياسة متى يمكن استرجاع قيمة الباقة ومتى لا يمكن، وكيف تُقدَّم الطلبات. وهي جزء من الشروط والأحكام.

## طبيعة الخدمة
تُشترى الباقة لكل مناسبة على حدة، وتُعد الخدمة منفَّذة عند إرسال أول دعوة إلى مدعو؛ لأن الرابط عندئذٍ قد وصل ولا يمكن سحبه.

## الحالات التي يُسترجع فيها المبلغ كاملًا
- إذا لم تُرسل أي دعوة بعد، وطلبت الاسترجاع خلال أربعة عشر يومًا من الدفع.
- إذا خُصمت قيمة الباقة مرتين عن المناسبة نفسها.
- إذا تعذّر على المنصة تقديم الخدمة لخلل فني من جانبنا استمر مانعًا للاستخدام ولم نتمكن من معالجته.

## الحالات التي لا يُسترجع فيها المبلغ
- بعد إرسال أول دعوة إلى أي مدعو.
- انتهاء موعد المناسبة أو انقضاؤها.
- عدم استخدام الباقة أو استخدام جزء من سقف المدعوين فيها.
- إلغاء المناسبة أو تأجيلها لسبب يخص المنظّم أو مقدّم خدمة آخر.
- عدم وصول رسالة واتساب لسبب خارج المنصة، كحظر الرقم أو خطأ في رقم المدعو أو انقطاع الخدمة لدى واتساب.
- مخالفة الشروط والأحكام على نحو أدى إلى إيقاف الحساب.

## تأجيل المناسبة
إذا أُجّلت مناسبتك ولم تكن قد أرسلت أي دعوة، يمكننا نقل الباقة إلى التاريخ الجديد دون رسوم بدلًا من الاسترجاع. وإذا كنت قد أرسلت الدعوات فبإمكانك تحديث التاريخ في المنصة وإعادة إشعار مدعويك، وتبقى الباقة نفسها سارية.

## ترقية الباقة
عند الترقية إلى باقة أعلى تُحتسب قيمة الباقة الحالية ضمن الجديدة. ولا يُسترجع الفرق عند الرغبة في النزول إلى باقة أدنى.

## التصاميم الخاصة
طلب التصميم الخاص عمل مُخصَّص يبدأ فور اعتماد الطلب، ولذلك:
- يمكن الإلغاء والاسترجاع الكامل قبل بدء العمل على التصميم.
- بعد تسليم أول معاينة لا يُسترجع المبلغ، وتبقى لك التعديلات المتفق عليها ضمن الطلب.

## كيف تطلب الاسترجاع
أرسل طلبك إلى ${SUPPORT} من رقم الجوال المسجَّل في الحساب، متضمنًا رقم الطلب واسم المناسبة وسبب الطلب. نراجع الطلب ونردّ عليك خلال ثلاثة أيام عمل.

## مدة تنفيذ الاسترجاع
عند الموافقة يُعاد المبلغ إلى الوسيلة نفسها التي دُفع بها. ويستغرق ظهوره في حسابك من خمسة إلى أربعة عشر يوم عمل بحسب البنك المُصدِر، وهي مدة خارجة عن سيطرتنا.

## التواصل
لأي استفسار بخصوص هذه السياسة: ${SUPPORT}`;

const REFUND_EN = `This policy explains when the price of a package can be refunded, when it cannot, and how to ask. It forms part of the terms and conditions.

## What you are buying
A package is bought per event. The service is treated as delivered once the first invitation has been sent to a guest, because at that point the link has arrived and cannot be recalled.

## When you get a full refund
- No invitation has been sent yet and you ask within fourteen days of payment.
- You were charged twice for the same event.
- We could not provide the service because of a fault on our side that continued to block use and that we were unable to resolve.

## When there is no refund
- After the first invitation has been sent to any guest.
- Once the event date has passed.
- Where a package went unused, or only part of its guest cap was used.
- Where the event is cancelled or postponed for a reason belonging to the host or another supplier.
- Where a WhatsApp message did not arrive for a reason outside the platform — a blocked number, a wrong number, or a WhatsApp outage.
- Where a breach of the terms and conditions led to the account being suspended.

## Postponement
If your event is postponed and no invitation has been sent, we can move the package to the new date at no charge instead of refunding it. If invitations have already gone out, you can update the date on the platform and re-notify your guests; the same package stays valid.

## Changing package
On upgrading, what you already paid is credited against the higher package. The difference is not refunded if you would rather move to a lower one.

## Custom designs
A custom design request is bespoke work that begins as soon as the request is accepted, so:
- It can be cancelled with a full refund before work starts.
- Once the first proof has been delivered there is no refund, and the revisions agreed in the request remain yours.

## How to request a refund
Write to ${SUPPORT_EN} from the mobile number registered on the account, giving the order number, the event name and your reason. We review it and reply within three working days.

## How long a refund takes
Once approved, the amount is returned to the method it was paid with. It takes between five and fourteen working days to appear in your account depending on the issuing bank, which is outside our control.

## Contact
For any question about this policy: ${SUPPORT_EN}`;

export interface LegalDefault {
  slug: LegalSlug;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  sortOrder: number;
}

/** Ordered as they should appear in the footer. */
export const DEFAULT_LEGAL_DOCUMENTS: LegalDefault[] = [
  {
    slug: 'terms',
    titleAr: 'الشروط والأحكام',
    titleEn: 'Terms and Conditions',
    bodyAr: TERMS_AR,
    bodyEn: TERMS_EN,
    sortOrder: 0,
  },
  {
    slug: 'privacy',
    titleAr: 'سياسة الخصوصية',
    titleEn: 'Privacy Policy',
    bodyAr: PRIVACY_AR,
    bodyEn: PRIVACY_EN,
    sortOrder: 1,
  },
  {
    slug: 'refund',
    titleAr: 'سياسة الاسترجاع',
    titleEn: 'Refund Policy',
    bodyAr: REFUND_AR,
    bodyEn: REFUND_EN,
    sortOrder: 2,
  },
];
