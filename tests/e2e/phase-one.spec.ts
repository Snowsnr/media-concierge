import { expect, test } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:4100';

test.beforeEach(async ({ request }) => {
  await request.post(`${apiUrl}/api/demo/reset`, { data: {} });
});

test('a family member can search and create a request', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('concierge-family-name', 'Ana'));
  await page.goto('/buscar');

  await page.getByPlaceholder('Duna, Alien, The Last of Us…').fill('Dune');
  await page.getByRole('link', { name: /Duna: Parte dos/ }).click();
  await expect(page.getByRole('heading', { name: 'Duna: Parte dos' })).toBeVisible();
  await page.getByPlaceholder('Por ejemplo: para el viernes…').fill('Para el sábado');
  await page.getByRole('button', { name: 'Pedir este título' }).click();

  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
  await expect(page.getByText('Solicitud recibida.')).toBeVisible();
});

test('the administrator manually completes the simulated movie workflow', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('link', { name: /Alien: Romulus/ }).click();
  await page.getByRole('button', { name: 'Aprobar y buscar releases' }).click();

  await expect(page.getByRole('heading', { name: 'Compara los lanzamientos' })).toBeVisible();
  await expect(page.getByText(/Bloqueado anteriormente: descarga estancada/)).toBeVisible();
  await page.getByRole('button', { name: 'Elegir' }).first().click();

  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: /Simular \+25%|Completar e importar/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Elige un subtítulo' })).toBeVisible();
  await page.getByRole('button', { name: 'Seleccionar' }).first().click();
  await page.getByRole('button', { name: 'Verificar disponibilidad' }).click();

  await expect(page.getByRole('heading', { name: 'Disponible en Jellyfin' })).toBeVisible();
});

test('series expose season-pack and per-episode states', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('link', { name: /Juego de tronos/ }).click();
  await page.getByRole('button', { name: 'Aprobar y buscar releases' }).click();

  await expect(page.getByText('Season pack · S01E01–S01E04')).toBeVisible();
  await page.getByRole('button', { name: 'Elegir' }).first().click();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: /Simular \+25%|Completar e importar/ }).click();
  }

  await expect(page.getByRole('button', { name: /S01E01 Falta subtítulo/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /S01E05 No emitido/ })).toBeDisabled();
  await expect(page.getByText('Marcar episodio listo sin subtítulos')).toBeVisible();

  for (let episode = 0; episode < 4; episode += 1) {
    await page.getByRole('button', { name: 'Seleccionar' }).first().click();
  }
  await page.getByRole('button', { name: 'Verificar disponibilidad' }).click();
  await expect(page.getByRole('heading', { name: 'Disponible en Jellyfin' })).toBeVisible();
});

test('simulated failures can be recovered without external services', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await page.getByRole('link', { name: /Alien: Romulus/ }).click();
  await page.getByRole('button', { name: 'Aprobar y buscar releases' }).click();
  await page.getByRole('button', { name: 'Elegir' }).first().click();

  await page.getByRole('button', { name: 'Pausar' }).click();
  await expect(page.getByRole('heading', { name: 'Descarga pausada' })).toBeVisible();
  await page.getByRole('button', { name: 'Reanudar' }).click();

  await page.getByLabel('Escenario simulado').selectOption({ label: 'Descarga estancada' });
  await page.getByRole('button', { name: 'Simular +25%' }).click();
  await expect(page.getByRole('heading', { name: 'Descarga estancada' })).toBeVisible();
  await page.getByRole('button', { name: 'Forzar reannounce' }).click();
  await page.getByRole('button', { name: 'Reanudar' }).click();

  await page.getByLabel('Escenario simulado').selectOption({ label: 'Importación demorada' });
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole('button', { name: /Simular \+25%|Completar e importar/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Esperando a Radarr/Sonarr' })).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar comprobación' }).click();

  await page.getByLabel('Escenario simulado').selectOption({ label: 'Sin subtítulos' });
  await expect(page.getByRole('heading', { name: 'No se encontraron subtítulos' })).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar búsqueda' }).click();
  await page.getByRole('button', { name: 'Seleccionar' }).first().click();

  await page.getByLabel('Escenario simulado').selectOption({ label: 'Biblioteca demorada' });
  await page.getByRole('button', { name: 'Verificar disponibilidad' }).click();
  await expect(page.getByText(/Jellyfin todavía no muestra el contenido/)).toBeVisible();
  await page.getByRole('button', { name: 'Verificar disponibilidad' }).click();
  await expect(page.getByRole('heading', { name: 'Disponible en Jellyfin' })).toBeVisible();
});

test('the administrator can create and revoke a one-time invitation', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174/invitaciones');
  await page.getByLabel('Identificador familiar').fill('Casa Rivera');
  await page.getByLabel('Expira en').selectOption('14');
  await page.getByRole('button', { name: 'Crear enlace seguro' }).click();

  await expect(
    page.getByText('Invitación creada. El enlace secreto solo se muestra ahora.'),
  ).toBeVisible();
  await expect(page.getByText(/http:\/\/localhost:5173\/#invite=demo-/)).toBeVisible();
  await expect(page.getByText(/Casa Rivera/)).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Revocar' }).click();
  await expect(page.getByText('No hay invitaciones remotas.')).toBeVisible();
});
