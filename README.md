# Calculadora

Calculadora científica para tablet Android, instalable como PWA. Inspirada en la comodidad del teclado de Photomath, sin cámara ni pasos, y con lo que a Photomath le falta: fasores, paralelo de impedancias y formatos de salida a medida.

## Qué hace

- **Editor matemático** (MathLive) con el teclado de Photomath: herramientas (abc, historial, ← →, ↵, ⌫) y pestañas +−×÷ · f(x) e log ln · sin cos tan cot · lim dx ∫ Σ ∞ · ℂ ∠ fasores. Las teclas con punto tienen alternativas al mantenerlas pulsadas. En pantalla ancha se ven funciones y números a la vez.
- **Resultado arriba**, justo debajo de la expresión, con una forma alternativa y el botón **Mostrar soluciones**: todas las notaciones (decimal, fracción, π, científica, ingeniería, prefijo SI, fija, rectangular, polar, exponencial…), y cualquiera se puede fijar como predeterminada.
- **Gráficas**: funciones y ecuaciones en 2D (arrastrar, pellizcar, tocar para leer valores), curvas de los sistemas con sus cortes, raíces complejas en el plano, diagrama fasorial y superficies 3D de f(x, y).
- **Complejos y fasores**: `10∠30°`, `j`/`i`, `|z|`, `arg`, `Re`, `Im`, conjugado, `Z₁ ∥ Z₂`.
- **Ecuaciones** con una incógnita (todas las raíces de polinomios, también complejas), **sistemas** con ↵ (lineales exactos con complejos, p. ej. mallas; no lineales por Newton) y **desigualdades** en notación de intervalos.
- **Cálculo**: derivadas simbólicas, integrales definidas (también impropias), integrales indefinidas de polinomios, límites (también laterales e infinitos), sumatorios y productorios.
- **Matrices** (también con complejos): suma, producto, potencias, inversa `A⁻¹`, traspuesta `Aᵀ`, determinante (`det` o barras), traza y rango. El panel de soluciones muestra además la inversa, la traspuesta y los valores propios. ↵ con el cursor dentro de una matriz añade una fila.
- **Historial automático** y `Ans`.

## Desarrollo

```bash
npm install
npm run dev        # servidor local (también accesible desde la red local)
npm test           # tests del motor de cálculo
npm run typecheck
npm run build      # versión de producción en dist/
```

El motor (`src/engine/`) es independiente de la interfaz: `parser.ts` convierte el LaTeX del editor en un árbol, `evaluate.ts` lo calcula con números complejos, `solve.ts` resuelve ecuaciones y `format.ts` da formato a los resultados.

## Instalar en la tablet

Una PWA solo se puede instalar si se sirve por HTTPS. Opciones:

1. **Publicarla** en un hosting estático gratuito (GitHub Pages, Netlify, Cloudflare Pages) con el contenido de `dist/`. Después, en Chrome de la tablet: menú ⋮ → *Añadir a pantalla de inicio* / *Instalar aplicación*.
2. **Probarla sin instalar**: con `npm run dev` en el PC, abre en la tablet `http://<IP-del-PC>:5173` (misma red Wi-Fi). Funciona en el navegador, pero no se instala ni funciona sin conexión.

Una vez instalada funciona sin internet.
