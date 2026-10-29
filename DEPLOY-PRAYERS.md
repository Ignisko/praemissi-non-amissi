# Wspólny znicz: wdrożenie na Vercel

Funkcja: gdy ktoś oznaczy osobę jako "pomodlony", wszyscy widzą to do północy (czas polski). Licznik dzienny jest wspólny dla wszystkich użytkowników.

## Co jest w kodzie

- `api/prayers.js`: funkcja serverless Vercela (bez zależności npm).
  - `GET /api/prayers` zwraca `{ date, counts: { "<id>": n } }`.
  - `POST /api/prayers` z ciałem `{ id, delta }` (delta = 1 lub -1) zwraca ten sam kształt.
  - Dane trzymane w Redis w hashu `prayers:<YYYY-MM-DD>` (data wg Europe/Warsaw), z TTL 48 h.
- `app.js`: pobiera liczniki przy wejściu, co 60 s i po powrocie do karty. Wysyła POST przy kliknięciu "Pomodliłem się".
- `dev-server.js`: lokalny serwer (`node dev-server.js`) z API w pamięci, bez Redis. Tylko do testów.

## Co trzeba zrobić na Vercelu

Wymaga konta z dostępem do projektu `praemissi-non-amissi`.

1. Dodać bazę Upstash Redis do projektu.
   - Panel: projekt → Storage (lub Marketplace) → Upstash → Redis → Create, plan Free, region najbliżej Polski (np. eu-central-1 / Frankfurt).
   - Podłączyć bazę do projektu `praemissi-non-amissi` dla środowisk Production, Preview i Development.
   - CLI zamiast panelu: `vercel integration add upstash` w katalogu projektu.
2. Sprawdzić, że w Settings → Environment Variables są zmienne `KV_REST_API_URL` i `KV_REST_API_TOKEN`. Integracja dodaje je sama. Kod przyjmuje też `UPSTASH_REDIS_REST_URL` i `UPSTASH_REDIS_REST_TOKEN`.
3. Wdrożyć zmiany z repo (push na gałąź produkcyjną albo `vercel --prod`). Zmienne środowiskowe działają dopiero po nowym wdrożeniu.

## Weryfikacja po wdrożeniu

```bash
curl https://praemissi-non-amissi.vercel.app/api/prayers
# oczekiwane: {"date":"YYYY-MM-DD","counts":{}}

curl -X POST -H 'Content-Type: application/json' -d '{"id":1,"delta":1}' https://praemissi-non-amissi.vercel.app/api/prayers
# oczekiwane: counts zawiera "1":1

curl -X POST -H 'Content-Type: application/json' -d '{"id":1,"delta":-1}' https://praemissi-non-amissi.vercel.app/api/prayers
# sprzątanie: counts znów puste
```

Jeśli GET zwraca 500, w logach funkcji (Vercel → Logs) będzie błąd Redis. Najczęściej brakuje zmiennych środowiskowych albo nie było ponownego wdrożenia.

Uwaga: bez zmiennych Redis API działa z pamięcią instancji. Na Vercelu będzie to zawodne, więc krok 1–2 jest obowiązkowy.

## Znane ograniczenia

- Brak limitu zapytań i uwierzytelniania po stronie serwera. Logowanie w aplikacji jest tylko lokalne w przeglądarce, więc ktoś może ręcznie wysłać POST. Do rozważenia później: rate limiting (Vercel Firewall lub Upstash Ratelimit).
