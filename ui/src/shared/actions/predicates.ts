// Libraries
import {Dispatch} from 'redux-thunk'
import {extractBoxedCol} from 'src/timeMachine/apis/queryBuilder'

// Utils
import {postDelete} from 'src/client'
import {runQuery} from 'src/shared/apis/query'
import {getWindowVars} from 'src/variables/utils/getWindowVars'
import {buildVarsOption} from 'src/variables/utils/buildVarsOption'
import {getVariableAssignments} from 'src/timeMachine/selectors'
import {checkQueryResult} from 'src/shared/utils/checkQueryResult'

// Actions
import {notify} from 'src/shared/actions/notifications'

// Constants
import {
  predicateDeleteFailed,
  predicateDeleteSucceeded,
  setFilterKeyFailed,
  setFilterValueFailed,
} from 'src/shared/copy/notifications'
import {rateLimitReached, resultTooLarge} from 'src/shared/copy/notifications'

// Types
import {GetState, Filter, RemoteDataState} from 'src/types'

export type Action =
  | DeleteFilter
  | ResetFilters
  | SetBucketName
  | SetDeletionStatus
  | SetFiles
  | SetFilter
  | SetIsSerious
  | SetKeysByBucket
  | SetPredicateToDefault
  | SetPreviewStatus
  | SetTimeRange
  | SetValuesByKey

interface DeleteFilter {
  type: 'DELETE_FILTER'
  payload: {index: number}
}

export const deleteFilter = (index: number): DeleteFilter => ({
  type: 'DELETE_FILTER',
  payload: {index},
})

interface ResetFilters {
  type: 'RESET_FILTERS'
}

export const resetFilters = (): ResetFilters => ({
  type: 'RESET_FILTERS',
})

interface SetPredicateToDefault {
  type: 'SET_PREDICATE_DEFAULT'
}

export const resetPredicateState = (): SetPredicateToDefault => ({
  type: 'SET_PREDICATE_DEFAULT',
})

interface SetBucketName {
  type: 'SET_BUCKET_NAME'
  payload: {bucketName: string}
}

export const setBucketName = (bucketName: string): SetBucketName => ({
  type: 'SET_BUCKET_NAME',
  payload: {bucketName},
})

interface SetDeletionStatus {
  type: 'SET_DELETION_STATUS'
  payload: {deletionStatus: RemoteDataState}
}

export const setDeletionStatus = (
  status: RemoteDataState
): SetDeletionStatus => ({
  type: 'SET_DELETION_STATUS',
  payload: {deletionStatus: status},
})

interface SetFiles {
  type: 'SET_FILES'
  payload: {files: string[]}
}

export const setFiles = (files: string[]): SetFiles => ({
  type: 'SET_FILES',
  payload: {files},
})

interface SetFilter {
  type: 'SET_FILTER'
  payload: {
    filter: Filter
    index: number
  }
}

export const setFilter = (filter: Filter, index: number): SetFilter => ({
  type: 'SET_FILTER',
  payload: {filter, index},
})

interface SetIsSerious {
  type: 'SET_IS_SERIOUS'
  payload: {isSerious: boolean}
}

export const setIsSerious = (isSerious: boolean): SetIsSerious => ({
  type: 'SET_IS_SERIOUS',
  payload: {isSerious},
})

interface SetKeysByBucket {
  type: 'SET_KEYS_BY_BUCKET'
  payload: {keys: string[]}
}

const setKeys = (keys: string[]): SetKeysByBucket => ({
  type: 'SET_KEYS_BY_BUCKET',
  payload: {keys},
})

interface SetPreviewStatus {
  type: 'SET_PREVIEW_STATUS'
  payload: {previewStatus: RemoteDataState}
}

export const setPreviewStatus = (
  status: RemoteDataState
): SetPreviewStatus => ({
  type: 'SET_PREVIEW_STATUS',
  payload: {previewStatus: status},
})

interface SetTimeRange {
  type: 'SET_DELETE_TIME_RANGE'
  payload: {timeRange: [number, number]}
}

export const setTimeRange = (timeRange: [number, number]): SetTimeRange => ({
  type: 'SET_DELETE_TIME_RANGE',
  payload: {timeRange},
})

interface SetValuesByKey {
  type: 'SET_VALUES_BY_KEY'
  payload: {values: string[]}
}

const setValues = (values: string[]): SetValuesByKey => ({
  type: 'SET_VALUES_BY_KEY',
  payload: {values},
})

export const deleteWithPredicate = params => async (
  dispatch: Dispatch<Action>
) => {
  try {
    const resp = await postDelete(params)

    if (resp.status !== 204) {
      throw new Error(resp.data.message)
    }

    dispatch(setDeletionStatus(RemoteDataState.Done))
    dispatch(notify(predicateDeleteSucceeded()))
    dispatch(resetPredicateState())
  } catch {
    dispatch(notify(predicateDeleteFailed()))
    dispatch(setDeletionStatus(RemoteDataState.Error))
    dispatch(resetPredicateState())
  }
}

export const executePreviewQuery = (query: string) => async (
  dispatch,
  getState: GetState
) => {
  dispatch(setPreviewStatus(RemoteDataState.Loading))
  try {
    const orgID = getState().orgs.org.id

    const variableAssignments = getVariableAssignments(getState())
    const windowVars = getWindowVars(query, variableAssignments)
    const extern = buildVarsOption([...variableAssignments, ...windowVars])
    const result = await runQuery(orgID, query, extern).promise

    if (result.type === 'UNKNOWN_ERROR') {
      throw new Error(result.message)
    }

    if (result.type === 'RATE_LIMIT_ERROR') {
      dispatch(notify(rateLimitReached(result.retryAfter)))

      throw new Error(result.message)
    }

    if (result.didTruncate) {
      dispatch(notify(resultTooLarge(result.bytesRead)))
    }

    checkQueryResult(result.csv)

    const files = [result.csv]
    dispatch(setFiles(files))
  } catch (e) {
    if (e.name === 'CancellationError') {
      return
    }

    console.error(e)
    dispatch(setPreviewStatus(RemoteDataState.Error))
  }
}

export const setBucketAndKeys = (orgID: string, bucketName: string) => async (
  dispatch: Dispatch<Action>
) => {
  try {
    const query = `import "influxdata/influxdb/v1"
    v1.tagKeys(bucket: "${bucketName}")
    |> filter(fn: (r) => r._value != "_stop" and r._value != "_start")`
    const keys = await extractBoxedCol(runQuery(orgID, query), '_value').promise
    keys.sort()
    dispatch(setBucketName(bucketName))
    dispatch(setKeys(keys))
  } catch {
    dispatch(notify(setFilterKeyFailed()))
    dispatch(setDeletionStatus(RemoteDataState.Error))
  }
}

export const setValuesByKey = (
  orgID: string,
  bucketName: string,
  keyName: string
) => async (dispatch: Dispatch<Action>) => {
  try {
    const query = `import "influxdata/influxdb/v1" v1.tagValues(bucket: "${bucketName}", tag: "${keyName}")`
    const values = await extractBoxedCol(runQuery(orgID, query), '_value')
      .promise
    values.sort()
    dispatch(setValues(values))
  } catch {
    dispatch(notify(setFilterValueFailed()))
    dispatch(setDeletionStatus(RemoteDataState.Error))
  }
}