/**
 * 腾讯云签名，参考 https://cloud.tencent.com/document/product/213/30654#NodeJS
 */
import crypto from 'crypto'

type BinaryEncoding = 'hex' | 'base64' | 'base64url'

function sha256(message: string, secret: string | Buffer = '', encoding?: BinaryEncoding) {
    const hmac = crypto.createHmac('sha256', secret)
    if (encoding) {
        return hmac.update(message).digest(encoding)
    }
    return hmac.update(message).digest()
}

function getHash(message: string, encoding: BinaryEncoding = 'hex') {
    const hash = crypto.createHash('sha256')
    return hash.update(message).digest(encoding)
}

function getDate(timestamp: number) {
    const date = new Date(timestamp * 1000)
    const year = date.getUTCFullYear()
    const month = ('0' + (date.getUTCMonth() + 1)).slice(-2)
    const day = ('0' + date.getUTCDate()).slice(-2)
    return `${year}-${month}-${day}`
}

export interface SignParams {
    secretID: string
    secretKey: string
    endpoint: string
    service: string
    region: string
    action: string
    version: string
    timestamp: number
    payload: object
    method: "POST" | "GET"
}

export function sign(params: SignParams) {
    const { payload, method, secretID, secretKey, endpoint, service, region, action, version, timestamp } = params
    const date = getDate(timestamp)

    const hashedRequestPayload = getHash(JSON.stringify(payload))
    const httpRequestMethod = method
    const canonicalUri = "/"
    const canonicalQueryString = ""
    const canonicalHeaders = "content-type:application/json; charset=utf-8\n"
        + "host:" + endpoint + "\n"
        + "x-tc-action:" + action.toLowerCase() + "\n"
    const signedHeaders = "content-type;host;x-tc-action"

    const canonicalRequest = httpRequestMethod + "\n"
        + canonicalUri + "\n"
        + canonicalQueryString + "\n"
        + canonicalHeaders + "\n"
        + signedHeaders + "\n"
        + hashedRequestPayload

    const algorithm = "TC3-HMAC-SHA256"
    const hashedCanonicalRequest = getHash(canonicalRequest)
    const credentialScope = date + "/" + service + "/" + "tc3_request"
    const stringToSign = algorithm + "\n" +
        timestamp + "\n" +
        credentialScope + "\n" +
        hashedCanonicalRequest

    const kDate = sha256(date, 'TC3' + secretKey)
    const kService = sha256(service, kDate)
    const kSigning = sha256('tc3_request', kService)
    const signature = sha256(stringToSign, kSigning, 'hex')

    const authorization = algorithm + " " +
        "Credential=" + secretID + "/" + credentialScope + ", " +
        "SignedHeaders=" + signedHeaders + ", " +
        "Signature=" + signature

    return authorization
}
