import { Link } from "react-router-dom";
import { ArrowLeft, Home } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 sm:h-14 object-cover object-center" />
            <p className="text-base sm:text-lg font-normal tracking-tight text-foreground uppercase">
              Правовая информация
            </p>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
              <Home className="w-4 h-4" /> <span>Главная</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto px-4 py-8 w-full">
        <div className="prose prose-sm max-w-none text-foreground space-y-6">
          <h1 className="text-2xl font-bold text-foreground">
            Пользовательское соглашение и Политика конфиденциальности
          </h1>
          <p className="text-xs text-muted-foreground">Дата публикации: 03 апреля 2026 г. | Последнее обновление: 03 апреля 2026 г.</p>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">1. Общие положения</h2>
            <p className="text-sm leading-relaxed">
              1.1. Настоящее Пользовательское соглашение и Политика конфиденциальности (далее — «Соглашение») 
              регулирует отношения между Найденовым Антоном Анатольевичем (далее — «Администратор», «Оператор») 
              и лицом, использующим веб-сервис DeAllsoft (далее — «Пользователь», «Сервис»).
            </p>
            <p className="text-sm leading-relaxed">
              1.2. Оператор персональных данных: <strong>Найденов Антон Анатольевич</strong>, контактный email: <strong>najdenovaa@gmail.com</strong>.
            </p>
            <p className="text-sm leading-relaxed">
              1.3. Регистрируясь на Сервисе, загружая документы и/или используя функции расчётов, 
              Пользователь выражает полное и безоговорочное согласие с настоящим Соглашением. 
              Если Пользователь не согласен с условиями, он обязан прекратить использование Сервиса.
            </p>
            <p className="text-sm leading-relaxed">
              1.4. Администратор вправе в одностороннем порядке изменять условия Соглашения путём публикации 
              новой редакции на данной странице. Продолжение использования Сервиса после внесения изменений 
              означает принятие новых условий.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">2. Предмет соглашения</h2>
            <p className="text-sm leading-relaxed">
              2.1. Сервис предоставляет Пользователю инструменты для инженерных расчётов в области 
              цементирования скважин, бурения и смежных направлений нефтегазовой отрасли, 
              а также функции AI-анализа документов.
            </p>
            <p className="text-sm leading-relaxed">
              2.2. Сервис предоставляется на условиях «как есть» (as is).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">3. Ограничение ответственности</h2>
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
              <p className="text-sm leading-relaxed font-semibold text-amber-800 dark:text-amber-300">
                ⚠️ ВАЖНО: Все данные, расчёты, отчёты, рекомендации и иные результаты, предоставляемые 
                Сервисом, носят исключительно информационный и справочный характер.
              </p>
            </div>
            <p className="text-sm leading-relaxed">
              3.1. Результаты расчётов, анализов и рекомендации Сервиса <strong>не являются</strong> проектной 
              документацией, руководством к действию, техническим заданием или экспертным заключением. 
              Они предназначены исключительно для предварительной оценки и информационных целей.
            </p>
            <p className="text-sm leading-relaxed">
              3.2. Администратор <strong>не несёт ответственности</strong> за:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 ml-4">
              <li>точность, полноту и достоверность результатов расчётов и анализов;</li>
              <li>любые убытки, ущерб (прямой, косвенный, случайный), упущенную выгоду, 
                возникшие в результате использования или невозможности использования Сервиса;</li>
              <li>решения, принятые Пользователем на основании данных Сервиса;</li>
              <li>последствия применения результатов расчётов на производстве, в том числе 
                аварии, простои, технологические отклонения;</li>
              <li>ошибки, возникшие из-за некорректных исходных данных, введённых Пользователем;</li>
              <li>сбои в работе Сервиса, потерю данных, перебои в доступе.</li>
            </ul>
            <p className="text-sm leading-relaxed">
              3.3. Пользователь самостоятельно несёт полную ответственность за использование результатов 
              Сервиса в профессиональной деятельности и обязуется верифицировать все данные перед 
              их применением.
            </p>
            <p className="text-sm leading-relaxed">
              3.4. Пользователь подтверждает, что является специалистом или имеет доступ к квалифицированным 
              специалистам, способным оценить корректность предоставляемых Сервисом данных.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">4. Обработка персональных данных</h2>
            <p className="text-sm leading-relaxed">
              4.1. Настоящий раздел является Политикой конфиденциальности и определяет порядок 
              обработки персональных данных в соответствии с Федеральным законом от 27.07.2006 
              № 152-ФЗ «О персональных данных».
            </p>
            <p className="text-sm leading-relaxed">
              4.2. <strong>Оператор персональных данных</strong>: Найденов Антон Анатольевич, email: najdenovaa@gmail.com.
            </p>
            <p className="text-sm leading-relaxed">
              4.3. <strong>Перечень обрабатываемых данных:</strong>
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 ml-4">
              <li>Адрес электронной почты (email) — для регистрации и входа;</li>
              <li>Хэш пароля — для аутентификации;</li>
              <li>IP-адрес и данные User-Agent — для обеспечения безопасности и аналитики;</li>
              <li>Загруженные документы и введённые параметры скважин — для выполнения расчётов и анализа;</li>
              <li>История расчётов и анализов — для обеспечения функционала личного кабинета;</li>
              <li>Файлы cookie и данные сессий — для авторизации и корректной работы Сервиса.</li>
            </ul>
            <p className="text-sm leading-relaxed">
              4.4. <strong>Цели обработки:</strong>
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 ml-4">
              <li>Предоставление доступа к функционалу Сервиса;</li>
              <li>Идентификация и аутентификация Пользователя;</li>
              <li>Хранение истории расчётов и обеспечение работы личного кабинета;</li>
              <li>Выполнение AI-анализа загруженных документов;</li>
              <li>Техническая поддержка и улучшение Сервиса;</li>
              <li>Выполнение обязанностей, предусмотренных законодательством РФ.</li>
            </ul>
            <p className="text-sm leading-relaxed">
              4.5. <strong>Правовые основания обработки</strong> (ст. 6 ФЗ-152):
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 ml-4">
              <li>Согласие субъекта персональных данных (п. 1 ч. 1 ст. 6);</li>
              <li>Исполнение договора (настоящего Соглашения) (п. 5 ч. 1 ст. 6).</li>
            </ul>
            <p className="text-sm leading-relaxed">
              4.6. <strong>Срок хранения:</strong> персональные данные хранятся в течение всего периода 
              существования учётной записи Пользователя и 1 (один) год после её удаления, 
              если иное не предусмотрено законодательством.
            </p>
            <p className="text-sm leading-relaxed">
              4.7. <strong>Передача третьим лицам:</strong> Оператор не передаёт персональные данные 
              третьим лицам, за исключением случаев:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 ml-4">
              <li>предусмотренных законодательством РФ (по запросу уполномоченных органов);</li>
              <li>использования сторонних сервисов для функционирования Сервиса (хостинг, аналитика) — 
                при условии обеспечения надлежащего уровня защиты данных.</li>
            </ul>
            <p className="text-sm leading-relaxed">
              4.8. <strong>Трансграничная передача:</strong> для обеспечения работоспособности Сервиса 
              данные могут обрабатываться на серверах, расположенных за пределами РФ, при условии 
              обеспечения адекватного уровня защиты в соответствии со ст. 12 ФЗ-152.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">5. Права Пользователя</h2>
            <p className="text-sm leading-relaxed">
              5.1. В соответствии со ст. 14–16 ФЗ-152 Пользователь имеет право:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 ml-4">
              <li>Получить информацию об обработке своих персональных данных;</li>
              <li>Потребовать уточнения, блокирования или уничтожения своих данных;</li>
              <li>Отозвать согласие на обработку персональных данных, направив письменное 
                уведомление на email: najdenovaa@gmail.com;</li>
              <li>Запросить удаление учётной записи и всех связанных данных.</li>
            </ul>
            <p className="text-sm leading-relaxed">
              5.2. При отзыве согласия на обработку данных Оператор прекращает обработку 
              в течение 30 (тридцати) дней с момента получения уведомления, за исключением 
              случаев, когда обработка допускается без согласия в соответствии с ФЗ-152.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">6. Защита данных</h2>
            <p className="text-sm leading-relaxed">
              6.1. Оператор принимает необходимые организационные и технические меры для защиты 
              персональных данных от несанкционированного доступа, уничтожения, изменения, 
              блокирования, копирования, распространения, а также от иных неправомерных действий 
              (ч. 1 ст. 19 ФЗ-152).
            </p>
            <p className="text-sm leading-relaxed">
              6.2. Применяемые меры включают: шифрование паролей, защищённые протоколы передачи 
              данных (HTTPS/TLS), контроль доступа к данным, регулярное обновление программного обеспечения.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">7. Интеллектуальная собственность</h2>
            <p className="text-sm leading-relaxed">
              7.1. Все элементы Сервиса (дизайн, программный код, алгоритмы, тексты, графика) 
              являются интеллектуальной собственностью Администратора и защищены законодательством РФ.
            </p>
            <p className="text-sm leading-relaxed">
              7.2. Копирование, модификация, распространение элементов Сервиса без письменного 
              согласия Администратора запрещено.
            </p>
            <p className="text-sm leading-relaxed">
              7.3. Документы, загруженные Пользователем, остаются собственностью Пользователя. 
              Администратор использует их исключительно для выполнения анализа в рамках Сервиса.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">8. Обязанности Пользователя</h2>
            <p className="text-sm leading-relaxed">
              8.1. Пользователь обязуется:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 ml-4">
              <li>Предоставлять достоверные данные при регистрации;</li>
              <li>Не передавать доступ к учётной записи третьим лицам;</li>
              <li>Не использовать Сервис для противоправных целей;</li>
              <li>Не предпринимать попыток несанкционированного доступа к Сервису;</li>
              <li>Самостоятельно верифицировать результаты расчётов и анализов перед их применением.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">9. Файлы cookie</h2>
            <p className="text-sm leading-relaxed">
              9.1. Сервис использует файлы cookie для обеспечения авторизации и корректной работы. 
              Продолжая использование Сервиса, Пользователь даёт согласие на использование cookie 
              в соответствии со ст. 18 Федерального закона от 27.07.2006 № 149-ФЗ.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">10. Порядок разрешения споров</h2>
            <p className="text-sm leading-relaxed">
              10.1. Все споры и разногласия подлежат разрешению путём переговоров. 
              При невозможности достичь соглашения спор передаётся на рассмотрение 
              в суд по месту нахождения Администратора в соответствии с законодательством РФ.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground border-b pb-1">11. Заключительные положения</h2>
            <p className="text-sm leading-relaxed">
              11.1. Настоящее Соглашение вступает в силу с момента принятия Пользователем 
              (регистрация, использование Сервиса) и действует бессрочно.
            </p>
            <p className="text-sm leading-relaxed">
              11.2. Вопросы, не урегулированные Соглашением, разрешаются в соответствии 
              с законодательством Российской Федерации.
            </p>
            <p className="text-sm leading-relaxed">
              11.3. По всем вопросам обращайтесь: <strong>najdenovaa@gmail.com</strong> или через{" "}
              <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Telegram-поддержку
              </a>.
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-border bg-card py-4">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} DeAllsoft. Все права защищены.
          </p>
        </div>
      </footer>
    </div>
  );
}
