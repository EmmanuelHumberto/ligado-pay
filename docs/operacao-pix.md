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
