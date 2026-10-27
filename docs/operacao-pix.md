# Operação privada do Pix

## Limite financeiro

Por determinação do titular, devoluções e cancelamentos são executados exclusivamente na conta InfinitePay. O Ligado Pay não oferece uma operação que envie dinheiro, escolha uma chave de destino ou execute cancelamento no provedor.

Uma solicitação, recibo ou aviso de webhook não comprova devolução. Não transformar um pagamento confirmado em devolvido apenas com esses dados. A baixa de uma devolução no SystemOS ainda exige um procedimento de conciliação verificada; os registros abaixo não implementam essa baixa.

## Recuperação e alertas

- A confirmação consulta a API oficial e valida os dados antes de registrar o pagamento. As pistas recebidas ficam em uma fila persistente, com tentativas limitadas e proteção contra processamento concorrente.
- Falha definitiva da fila, criação incerta, falta de identificadores, conferência financeira e checkout vencido geram pendências. Sem identificadores suficientes, obter os dados na conta InfinitePay: não recriar a cobrança por tentativa.
- Expiração oculta o link vencido no resumo do SystemOS. Não presume cancelamento, não libera outra emissão e não descarta uma confirmação tardia.
- `GET /v1/operations` e `GET /v1/payments/:id/operations` exigem autenticação de serviço e respeitam aplicação/recebedor. O relatório lista até cem registros e informa `truncated`; não é um extrato bancário.
- O monitor operacional existente do SystemOS consulta o relatório e grava códigos sem dados pessoais em `monitor-status.json` e `alertas.jsonl`, na pasta privada `SystemOSOperacao`. Não há envio de mensagem ou push ao cliente.

## Intervenção auditada

As rotas POST de operações e reconciliação exigem `payments:operations`, chave de idempotência e vínculo com o pagamento original. Não são publicadas pelo proxy do portal nem consumidas pelo aplicativo do cliente.

`scripts/payment-operations.mjs` aceita `list`, `get`, `retry` e `request`, com `--config-file` absoluto apontando à configuração privada do consumidor. `get`, `retry` e `request` exigem `--payment-id` UUID. Escritas exigem `--input-file` absoluto e `--attempt-id` UUID. Sem `--execute`, apresentam somente a prévia.

Entrada de `retry`: `{ "orderNsu": "UUID do pagamento", "transactionNsu": "UUID da transação", "slug": "slug do checkout" }`. O comando agenda reconsulta da tentativa existente; não cria nem confirma cobrança por conta própria.

Entrada de `request`: `kind` (`REFUND_REQUEST`, `CANCEL_REQUEST` ou `EVIDENCE_RECORDED`), `reasonCode` em maiúsculas e, conforme o tipo, `amountCents` ou `evidenceSha256`. O resultado é uma intenção pendente, nunca uma devolução concluída. Não fornecer dados bancários, documentos ou segredos nesses arquivos. Devoluções solicitadas não podem somar mais que o pagamento confirmado.

Avisos `refunded`/`canceled` reconhecidos no webhook são registrados como não verificados, deduplicados e encaminhados à conferência. Não mudam o estado financeiro. Novos links solicitam esses eventos ao provedor; links anteriores não são reconfigurados retroativamente. O recebimento real desses eventos não foi homologado com uma devolução de dinheiro.

Os registros de intervenção são append-only para o papel runtime. Eles permanecem pendentes até que exista conciliação verificada; não há encerramento automático nem alegação de estorno concluído.


## Encerrar pendência operacional

`payment-operations.mjs resolve` usa os mesmos argumentos de configuração, pagamento, entrada e tentativa do comando `request`. A entrada contém `operationId`, `reasonCode` e `evidenceSha256`. Sem `--execute`, apresenta a prévia. A rota privada `/v1/payments/:id/operations/:operationId/resolve` exige `payments:operations`; repetição com conteúdo diferente é recusada. Encerrar um aviso não comprova devolução.

## Registrar devolução já conferida na conta InfinitePay

Não há rota HTTP que registre ou envie uma devolução. O papel runtime tem somente SELECT em `bank_refund_reconciliations`; o token do SystemOS não tem essa capacidade.

O operador deve conferir a devolução na conta InfinitePay e obter referência bancária, valor, transação original e evidência. Um arquivo de entrada de até 4 KiB contém exatamente `id` (UUID desta conciliação), `paymentId`, `transactionNsu` original, `providerRefundReference`, `amountCents`, `occurredAt` em ISO e `evidenceSha256`. Não colocar CPF, chave API, dados bancários ou URL nesse arquivo.

- Prévia: `node scripts/reconcile-bank-refund.mjs --input-file CAMINHO_ABSOLUTO`.
- Após conferência: repetir com `--execute --confirm-infinitepay-reviewed`, sob identidade de operador com acesso ao banco administrativo local. O comando não consulta nem movimenta dinheiro no provedor; registra a conferência humana, com papel do banco e horário.
- O registro exige liquidação original Pix, transação correspondente, valor positivo e total acumulado dentro da liquidação. Histórico imutável, referência bancária única e serialização impedem dupla contabilização.
- A API mantém a liquidação original e acrescenta `refundedAmountCents`. O SystemOS sincroniza pagamentos aprovados a cada seis horas ou em consulta explícita, aplica valores parciais/totais sem regressão e mostra o valor devolvido no portal/app. Pagamento devolvido não habilita nova cobrança automática.

A execução real desse procedimento exige uma devolução efetivamente conferida pelo operador. Os testes desta correção usam somente bancos descartáveis e dados sintéticos. Não foi executada uma devolução real nem registrada uma baixa financeira de teste na base operacional.

## Proxy e fila

O Next encaminha o webhook por rota com limite de corpo e metadados HMAC de origem/horário/corpo. A chave do proxy é independente da chave bancária. Essa assinatura autentica o encaminhamento local, não a autoria bancária do evento. A verdade financeira continua vindo de `/payment_check` autenticado. A origem HTTP permanece em loopback; o identificador de IP fornecido por Cloudflare não pode ser aceito de acesso direto público à origem.

As pistas públicas têm fila limitada e substituível; uma rajada não esgota uma cota vitalícia. Reconsultas autenticadas verificam diretamente e têm prioridade na recuperação. Cotas de leitura, criação e conferência são separadas. A proteção não representa garantia de disponibilidade contra todo ataque volumétrico.

## Limite operacional em aberto

PAY-07 continua aberto: API, web e gateway ainda compartilham SID Windows. A implantação em contas dedicadas e diretórios protegidos está descrita em `../os-system-web/docs/ISOLAMENTO_RUNTIME_WINDOWS.md` e requer sessão administrativa. Não interpretar DPAPI ou banco próprio como isolamento de processos já concluído.
