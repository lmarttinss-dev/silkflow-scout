# ML Scout × SilkFlow — Integração

## Visão geral

O ML Scout e o SilkFlow se encaixam naturalmente nas duas pontas do mesmo fluxo: o Scout valida **se vale importar** antes de gastar dinheiro, e o SilkFlow gerencia **tudo depois** que a decisão é tomada.

## Posição no ciclo de importação

```
Ideia de produto
      ↓
 [ML Scout] ── Tem demanda? Há margem? Quanta concorrência?
      ↓  (resposta = sim)
 [SilkFlow] ── Encontrar fornecedor → calcular custo → importar → vender → analisar resultado
```

## Pontos de integração

### 1. Validação pré-compra

Antes de fazer qualquer pedido no 1688, o usuário abre o produto equivalente no ML, o Scout exibe score, vendas estimadas e margem. O SilkFlow importa esses dados para embasar a decisão de importar — e quantas unidades pedir.

### 2. Calculadora de viabilidade

O Scout retorna o preço médio dos concorrentes. O SilkFlow usa esse número como "preço de venda máximo realista" na calculadora de custo de importação, respondendo automaticamente: *essa margem fecha?*

### 3. Monitoramento contínuo

Após importar, o Scout acompanha a posição de preço do produto no ML. Se a concorrência baixar o preço ou novos vendedores entrarem, o SilkFlow recebe o alerta e sugere ajuste de precificação ou pausa nas reposições.

### 4. Descoberta de produtos

O usuário navega no ML buscando oportunidades. O Scout destaca os produtos com alta demanda e baixa concorrência. Com um clique, abre o SilkFlow já com o nome do produto preenchido para buscar fornecedor no 1688.

## Impacto no backlog

Três cards do SilkFlow já preveem essa integração diretamente:

| Card | Como o Scout se encaixa |
|---|---|
| Análise de demanda antes de importar | Scout fornece o volume de buscas e vendas estimadas |
| Validação de oportunidade com ML Scout | Integração explícita: score e concorrentes no fluxo de cadastro |
| Precificação automática com margem alvo | Preço médio dos concorrentes vem do Scout |

## Papel estratégico

O ML Scout atua como o **front-end de inteligência de mercado** do SilkFlow — um sensor que observa o Mercado Livre em tempo real e alimenta as decisões dentro da plataforma. Sem o Scout, o SilkFlow opera às cegas sobre o lado da demanda; sem o SilkFlow, o Scout identifica oportunidades mas não fecha o ciclo operacional.
