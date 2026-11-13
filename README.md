# 🥊 UFC Bet Analyzer

![Status](https://img.shields.io/badge/Status-Em%20Desenvolvimento%20(WIP)-f59e0b?style=for-the-badge)
![Tipo](https://img.shields.io/badge/Tipo-Projeto%20Pessoal-3b82f6?style=for-the-badge)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js%20(Serverless)-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google%20Gemini%20AI-8E75B2?style=for-the-badge&logo=google&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

> [!IMPORTANT]
> **Projeto Pessoal em Desenvolvimento:** Este é um projeto pessoal em evolução contínua, criado para estudo de modelagem matemática, análise estatística aplicada ao MMA/UFC e demonstração de portfólio.

---

## 🎯 Para que funciona

O **UFC Bet Analyzer** é uma plataforma de apoio à decisão e análise estatística para eventos do UFC. Seu objetivo é identificar oportunidades de **Valor Esperado Positivo (EV+)** comparando as probabilidades implícitas das casas de apostas com um modelo matemático próprio que avalia características físicas, estilos de luta, idade, poder de finalização e histórico real de resultados.

Em vez de depender apenas de intuição, o sistema quantifica vantagens objetivas entre dois lutadores e aponta onde o mercado pode estar precificando mal um confronto.

---

## ⚙️ Como funciona e por que o modelo é exato

O funcionamento do sistema é dividido em quatro camadas integradas que transformam dados brutos em recomendações matemáticas claras:

### 1. Cruzamento de Dados Reais (Multi-Fonte)
O analisador combina múltiplas fontes de dados para montar o perfil completo de cada confronto:
- **Base Local de Lutadores:** Mais de 4.000 lutadores catalogados com altura, envergadura, guarda (*stance*) e estilo predominante.
- **ESPN API:** Busca cards atualizados, fotos dos atletas, registros oficiais, categorias de peso e odds ao vivo.
- **Wikipedia API:** Extrai idade, histórico recente de adversários e detalhamento de vitórias por nocaute (KO), finalização (Sub) e decisão.
- **Base Histórica (Google Sheets):** Consolida dados auditados de dezenas de eventos anteriores do UFC para medir desempenho real, ROI e padrões por faixa de odds.

### 2. Remoção da Margem da Casa (*Overround*)
Antes de calcular qualquer vantagem, o sistema converte as odds decimais dos dois lutadores em probabilidades brutas ($1 / \text{Odd}$) e normaliza os valores para que a soma total seja exatamente $100\%$. Isso remove a margem de lucro embutida pela casa de apostas (*juice/overround*) e estabelece a **probabilidade implícita real** de mercado como linha de base.

### 3. Motor de Ajuste Multi-Fator
Sobre a probabilidade implícita real, o motor estatístico (`js/analyzer.js`) aplica ajustes calibrados com pesos específicos e limites definidos para evitar distorções extremas:

- **Vantagem Física (ajuste máximo de $\pm 12\%$):** Calcula a diferença absoluta em centímetros de altura e envergadura entre os lutadores (normalizada em até $\pm 20\text{ cm}$, onde cada $5\text{ cm}$ equivale a $\pm 0{,}25$). A **envergadura possui peso de $70\%$** (por seu impacto direto no controle de distância e *striking*) e a **altura possui peso de $30\%$**.
- **Matchup de Estilos de Luta (ajuste máximo de $\pm 8\%$):** Cruza o estilo principal de cada atleta (*Striker*, *Grappler*, *Wrestler*, *All-Round*) com uma matriz de *win rate* histórico do UFC (por exemplo, *Wrestler vs. Striker* com $54\%$ de vantagem histórica e *Striker vs. Grappler* com $52\%$).
- **Fator Idade / Auge Atlético (ajuste máximo de $\pm 5\%$):** Compara o momento físico dos atletas: lutadores no auge ($27$ a $32$ anos) recebem bônus ($+0{,}10$), jovens sem tanta rodagem ($< 24$ anos) sofrem leve penalidade ($-0{,}05$), e veteranos passam por redução progressiva ($36\text{–}38$ anos: $-0{,}08$; acima de $38$ anos: $-0{,}15$).
- **Taxa de Finalização / *Finishing Rate* (ajuste máximo de $\pm 3\%$):** Mede a proporção de vitórias por via rápida ($\text{KO} + \text{Sub}$ divididos pelo total de vitórias), atribuindo vantagem relativa ao lutador mais letal frente a lutadores que dependem exclusivamente de decisões.

Após somar esses ajustes, a probabilidade final ajustada ($\text{Prob}_{\text{Adj}}$) é limitada entre $2\%$ e $98\%$ para manter estabilidade numérica.

### 4. Cálculo Exato de Valor Esperado (EV+) e Confiança
Com a probabilidade ajustada definida, o algoritmo calcula o Valor Esperado exato para ambos os lados utilizando a fórmula clássica:

$$\text{EV} = (\text{Prob}_{\text{Adj}} \times (\text{Odd} - 1)) - (1 - \text{Prob}_{\text{Adj}})$$

- Quando $\text{EV} > 0$, a aposta possui **Valor Esperado Positivo (EV+)** no longo prazo.
- Se nenhum dos lados apresentar EV positivo, o sistema ainda indica o lado com maior probabilidade ajustada, sinalizando claramente que não há valor matemático na odd atual.
- Em lutas recém-anunciadas que ainda não possuem odds publicadas, o modelo gera uma estimativa técnica baseada exclusivamente nos fatores físicos, estilo, idade e taxa de finalização.
- Por fim, é calculado um **Score de Confiança ($10\%$ a $90\%$)** dividido em *Alta Confiança* ($\ge 70\%$), *Confiança Média* ($55\text{–}69\%$) e *Baixa Confiança* ($< 55\%$).

---

## ✨ Funcionalidades Principais

- **⚡ Cards de Luta Interativos (Lutas Futuras e Passadas):** Visualização completa dos confrontos com fotos dos lutadores, cartel, barras comparativas de altura e envergadura, selos de estilo, probabilidades implícitas vs. ajustadas, indicador de EV e pick oficial do algoritmo.
- **🦓 Detector de Padrões de Zebra ("Zebra Quente 🔥"):** Classifica todas as odds em 7 faixas (*Super Favorito* `1.01–1.25` até *Super Zebra* `3.21+`) e monitora a taxa histórica de acertos. Quando uma faixa de azarão ($\text{Odd} \ge 2{,}50$) atinge *hit rate* histórico $\ge 32\%$ (com mínimo de 5 picks auditados), o card exibe automaticamente o alerta **"ZEBRA QUENTE 🔥"**.
- **💰 Calculadora de Gestão de Banca e Risco:** Sugere o valor exato da aposta (*stake*) em Reais (`R$`), Dólares (`$`) ou Unidades (`u`) a partir de 4 estratégias de gestão: **Flat Bet (Aposta Fixa)**, **Critério de Kelly** (`1/10`, `1/4`, `1/2` ou `Kelly Cheio`), **Proporcional ao EV** e **Proporcional à Confiança**.
- **📊 Dashboard de Desempenho Histórico e Simulador de ROI:** Acompanha acertos, erros e ROI acumulado por evento; compara o desempenho do algoritmo contra estratégias de referência; avalia o retorno das apostas sugeridas (Simples, Dupla e Tripla) e exibe gráficos de vitórias por cruzamento de estilos (*Grapplers vs. Strikers*).
- **🤖 Especialista UFC com Inteligência Artificial:** Chatbot flutuante e botão de análise individual por luta integrados ao **Google Gemini (`gemini-2.5-flash`)**, que recebem em tempo real os eventos e os picks oficiais do algoritmo para fornecer justificativas táticas alinhadas aos dados matemáticos.
- **✏️ Banco de Dados Local Editável:** Interface modal que permite editar ou cadastrar medidas físicas (altura, envergadura), guarda e estilo de qualquer lutador diretamente no navegador (`localStorage`), recalculando probabilidades e EV instantaneamente.

---

## 🛠️ Tecnologias Utilizadas

- **Frontend:** HTML5, CSS3 e JavaScript (Vanilla)
- **Visualização de Dados:** Chart.js
- **Backend / Serverless:** Node.js (Vercel Serverless Functions)
- **Inteligência Artificial:** Google Gemini API (`@google/genai`)
- **Integrações de Dados:** ESPN API, Wikipedia API e Google Sheets API

---

## 📌 Status do Desenvolvimento

🚧 **Em andamento** — Por ser um projeto pessoal em desenvolvimento ativo, novos ajustes de pesos estatísticos, melhorias visuais, automações de coleta e refinamentos no modelo de análise continuam sendo implementados.

---

*Desenvolvido por [Josué Faria](https://github.com/Josufaria) — Projeto pessoal para estudo, análise esportiva e portfólio.*
