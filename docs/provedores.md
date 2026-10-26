# Provedores e critérios de habilitação

Pesquisa preliminar em 25/10/2026. Documentação encontrada não comprova contratação, elegibilidade da conta, segurança de uma implantação nem aprovação para produção. Nenhum conector foi implementado neste repositório.

## Pix

Banco Central define o arranjo e o padrão API Pix. A Ligado contrata a API de uma instituição participante para gerar cobranças e confirmar recebimentos. Não oferecer “Banco Central” como provedor de cobrança nem assumir que Pix é gratuito por usar seu padrão.

Fontes: [BC para empresas](https://www.bcb.gov.br/en/financialstability/pixbusinesses), [contratação por PJ e MEI](https://www.bcb.gov.br/detalhenoticia/21252/noticia).

## Pesquisa inicial

| Instituição | Evidência pública | Situação no Ligado Pay |
|---|---|---|
| Mercado Pago | Referência oficial de cobrança, consulta, cancelamento e estorno; integração já existente no SystemOS | Primeiro candidato a extração gradual; exige homologação própria sem copiar segredos ou alterar os pagamentos existentes |
| Efí | API Pix, autenticação/certificados, escopos e webhook com mTLS documentados | Candidata a Pix por PSP; confirmar contratação e demonstrar mTLS na infraestrutura escolhida |
| Banco do Brasil | API Pix para QR e verificação de liquidação documentada | Candidato; confirmar elegibilidade, contrato e requisitos completos antes de construir adaptador |
| InfinitePay | Checkout, webhook e consulta payment_check documentados | Em avaliação; comprovar autenticidade, correlação financeira, devolução, testes e recuperação antes de habilitar |
| Nubank | Cobrança por aplicativo Nu Empresas documentada | API de cobrança automatizada adequada não confirmada nesta pesquisa; não integrar por scraping, e-mail, comprovante ou biblioteca não oficial |

## Condições de entrada

- Documentação oficial identificável, versionamento, termos compatíveis e acesso contratável pela conta da Ligado.
- Criar cobrança, consultar estado no servidor e correlacionar identificador, recebedor e valor; expiração e cancelamento com semântica definida.
- Devolução/estorno e tratamento de resultados incertos. Para cartão, capacidades de contestação e fluxo de tokenização/checkout compatíveis.
- Autenticação das chamadas e estratégia verificável de autenticidade das notificações; notificações não confiáveis não bastam para liberar pagamento.
- Idempotência nativa ou estratégia comprovada contra duplicidade, incluindo falha de rede depois da criação. Consulta de recuperação e conciliação obrigatórias.
- Ambiente de teste ou processo oficial de homologação que cubra as falhas necessárias; suporte e limites operacionais conhecidos.
- Segregação de teste/produção, rotação/revogação de credenciais, permissões mínimas e validação da conta recebedora.
- Registrar capacidades individualmente: Pix em um provedor não implica suporte a cartão, estorno parcial ou todos os métodos. API pública e UI só apresentam o que estiver homologado e habilitado.

Não incorporar um provedor com lacunas críticas só para aumentar opções. Custos, disponibilidade comercial e qualidade operacional ainda precisam ser comparados antes da escolha do segundo provedor.

## Fontes oficiais

- [Mercado Pago API](https://www.mercadopago.com.br/developers/en/reference)
- [Efí credenciais e certificados](https://dev.efipay.com.br/docs/api-pix/credenciais/)
- [Efí webhooks](https://dev.efipay.com.br/en/docs/api-pix/webhooks/)
- [Banco do Brasil API Pix](https://www.bb.com.br/site/developers/api-pix/)
- [InfinitePay checkout](https://www.infinitepay.io/checkout-documentacao)
- [Nu Empresas cobrança](https://nubank.com.br/empresas/solucoes-para-cobranca)
